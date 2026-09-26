"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { LayoutDashboard, FileText, MessageSquare, BarChart2, Upload, Trash2, RefreshCw, ChevronDown, LogOut, X, AlertTriangle, FileStack, Target, MessagesSquare, ThumbsUp, BarChart3, ThumbsDown, type LucideIcon } from "lucide-react";

interface Doc {
  doc_id: string; filename: string;
  status: "pending"|"processing"|"indexed"|"failed";
  chunk_count: number|null; is_active: boolean; created_at: string;
}
interface Inquiry {
  inquiry_id: string; question: string; answer: string;
  confidence: number; source_filename: string|null;
  escalated: boolean; feedback: number|null; created_at: string;
  session_id: string|null; session_title: string; session_size: number;
  session_position: number; is_session_start: boolean;
  user_id: string; full_name: string|null; email_address: string|null;
}
interface User { full_name: string; role_id: string; }
type Tab = "overview"|"documents"|"interactions"|"feedback";

const MANILA_TIMEZONE = "Asia/Manila";

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Unknown";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSeconds < 60) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-PH", {
    timeZone: MANILA_TIMEZONE, month: "short", day: "numeric", year: "numeric",
  });
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const datePart = date.toLocaleDateString("en-PH", {
    timeZone: MANILA_TIMEZONE, month: "short", day: "numeric", year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-PH", {
    timeZone: MANILA_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: true,
  });
  return `${datePart} · ${timePart}`;
}

function formatSessionTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-PH", {
    timeZone: MANILA_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function statusVariant(s: string): "success"|"pending"|"failed"|"processing" {
  return ({ indexed:"success", pending:"pending", processing:"processing", failed:"failed" } as Record<string,any>)[s] || "pending";
}
function statusLabel(s: string) {
  return ({ indexed:"Successful", pending:"Pending", processing:"Processing", failed:"Failed" } as Record<string,string>)[s] || s;
}
function statusBadgeClass(s: string) {
  return ({ indexed:"bg-green-50 border-green-200", pending:"bg-yellow-50 border-yellow-200", processing:"bg-blue-50 border-blue-200", failed:"bg-red-50 border-red-200" } as Record<string,string>)[s] || "bg-gray-50 border-gray-200";
}
function statusDotClass(s: string) {
  return ({ indexed:"bg-green-500", pending:"bg-yellow-500", processing:"bg-blue-500", failed:"bg-red-500" } as Record<string,string>)[s] || "bg-gray-400";
}
function confVariant(c: number): "high"|"medium"|"low" {
  if (c >= 0.75) return "high";
  if (c >= 0.45) return "medium";
  return "low";
}
function confidenceBarClass(c: number) {
  return c >= 0.75 ? "bg-green-500" : c >= 0.45 ? "bg-yellow-500" : "bg-red-500";
}
function ConfidenceBadge({ confidence }: { confidence: number }) {
  return (
    <Badge variant={confVariant(confidence)} className="flex-col items-start gap-1">
      <span>{(confidence * 100).toFixed(1)}%</span>
      <span className="block w-[60px] max-w-full h-0.5 rounded bg-black/10 overflow-hidden">
        <span className={cn("block h-full rounded", confidenceBarClass(confidence))} style={{ width: `${Math.max(0, Math.min(100, confidence * 100))}%` }} />
      </span>
    </Badge>
  );
}
function confLabel(c: number) {
  if (c >= 0.75) return "High Confidence";
  if (c >= 0.45) return "Medium Confidence";
  return "Low Confidence";
}
function studentName(inquiry: Inquiry) {
  return inquiry.full_name || inquiry.email_address || "Unknown student";
}
function studentInitials(name: string) {
  const initials = name.split(/\s+/).filter(Boolean).map(part => part[0]).join("");
  return (initials || "ST").slice(0, 2).toUpperCase();
}
function truncateTitle(title: string) {
  return title.length > 40 ? `${title.slice(0, 40).trimEnd()}…` : title;
}

function AdminContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab,          setTab]          = useState<Tab>((searchParams.get("tab") as Tab) || "overview");
  const [user,         setUser]         = useState<User|null>(null);
  const [docs,         setDocs]         = useState<Doc[]>([]);
  const [inquiries,    setInquiries]    = useState<Inquiry[]>([]);
  const [searchQuery,  setSearchQuery]  = useState("");
  const [refreshing,   setRefreshing]   = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [dragOver,     setDragOver]     = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setSearchQuery("");
    router.replace(`?tab=${newTab}`, { scroll: false });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadInquiries();
    setTimeout(() => setRefreshing(false), 600);
  };

  const loadDocs      = useCallback(async () => { const r = await fetch("/api/proxy/documents/",     { credentials:"include" }); if (r.ok) setDocs(await r.json()); }, []);
  const loadInquiries = useCallback(async () => { const r = await fetch("/api/proxy/query/history", { credentials:"include" }); if (r.ok) setInquiries(await r.json()); }, []);

  useEffect(() => {
    const tabFromUrl = searchParams.get("tab") as Tab;
    if (tabFromUrl && tabFromUrl !== tab) setTab(tabFromUrl);
  }, [searchParams, tab]);

  useEffect(() => {
    fetch("/api/proxy/auth/me", { credentials:"include" })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (d.role_id !== "admin") router.push("/chat"); setUser(d); })
      .catch(() => router.push("/login"));
    loadDocs(); loadInquiries();
  }, [router, loadDocs, loadInquiries]);

  useEffect(() => {
    const h = () => setShowDropdown(false);
    if (showDropdown) document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [showDropdown]);

  const filteredDocs = docs.filter(doc =>
    searchQuery === "" ||
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredInquiries = inquiries.filter(q =>
    searchQuery === "" ||
    q.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    q.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (q.source_filename ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    indexed:   docs.filter(d => d.status === "indexed").length,
    queries:   inquiries.length,
    avgConf:   inquiries.length > 0 ? inquiries.reduce((s,i) => s+i.confidence,0)/inquiries.length : 0,
    thumbsUp:  inquiries.filter(i => i.feedback === 1).length,
    thumbsDown:inquiries.filter(i => i.feedback === -1).length,
    escalated: inquiries.filter(i => i.escalated).length,
  };

  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { alert("Only PDF files accepted."); return; }
    setUploading(true);
    const form = new FormData(); form.append("file", file);
    const r = await fetch("/api/proxy/documents/", { method:"POST", credentials:"include", body:form });
    if (r.ok) {
      await loadDocs();
      alert(
        "Document uploaded successfully. " +
        "If status shows Pending, click Refresh in 30 seconds to see the updated status."
      );
    }
    else { const e = await r.json(); alert(e.detail || "Upload failed."); }
    setUploading(false);
  };

  const toggleDoc = async (doc_id: string) => {
    await fetch(`/api/proxy/documents/${doc_id}/toggle`, { method:"PATCH", credentials:"include" });
    loadDocs();
  };
  const deleteDoc = async (doc_id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await fetch(`/api/proxy/documents/${doc_id}`, { method:"DELETE", credentials:"include" });
    loadDocs();
  };
  const deleteInquiry = async (inquiry_id: string, question: string) => {
    const confirmed = confirm(
      `Delete this inquiry?\n\n"${question.slice(0, 80)}${question.length > 80 ? "..." : ""}"\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(inquiry_id);

    try {
      const response = await fetch(
        `/api/proxy/query/${inquiry_id}`,
        { method: "DELETE", credentials: "include" }
      );

      if (response.ok) {
        setInquiries(current => current.filter(item => item.inquiry_id !== inquiry_id));
      } else {
        const error = await response.json().catch(() => ({}));
        alert(error.detail || "Failed to delete inquiry.");
      }
    } catch (error) {
      alert("Network error. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };
  const logout = async () => {
    await fetch("/api/proxy/auth/logout", { method:"POST", credentials:"include" });
    router.push("/login");
  };

  const initials = user?.full_name?.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() || "AD";

  const navItems = [
    { key:"overview",     label:"Dashboard Overview", Icon: LayoutDashboard },
    { key:"documents",    label:"Document Manager",   Icon: FileText        },
    { key:"interactions", label:"Interaction Logs",   Icon: MessageSquare   },
    { key:"feedback",     label:"Feedback Analytics", Icon: BarChart2       },
  ] as { key: Tab; label: string; Icon: LucideIcon }[];

  const StatCard = ({ label, value, sub, subColor, icon: Icon }: { label:string; value:string; sub:string; subColor:string; icon:LucideIcon }) => (
    <Card className="bg-[#FAFAF8]">
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle>{label}</CardTitle>
          <span className="w-10 h-10 rounded-xl bg-maroon/8 flex items-center justify-center text-maroon"><Icon size={18} /></span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-foreground mb-1">{value}</p>
        <p className={cn("text-xs font-medium", subColor)}>{sub}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex h-screen overflow-hidden font-sans">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-56 sidebar-gradient flex flex-col shrink-0">
        <div className="px-5 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gold flex items-center justify-center text-lg">🤖</div>
            <div>
              <p className="text-white font-bold text-sm leading-none">LISSA</p>
              <p className="text-white/40 text-[10px] mt-0.5">AI Support Agent</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 pt-4">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest px-3 pb-3">Navigation</p>
          {navItems.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => handleTabChange(key)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium mb-0.5 transition-colors text-left",
                "border-l-2",
                tab === key
                  ? "bg-gold/10 text-gold border-l-2 border-gold"
                  : "text-white/65 hover:bg-white/8 hover:text-white"
              )}>
              <Icon size={15} className="shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">System Status</p>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-[11px] text-white/70">All Systems Operational</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="text-[11px] bg-gold text-maroon font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white font-medium truncate">{user?.full_name || "Admin"}</p>
              <p className="text-[10px] text-white/35">Role: Admin</p>
            </div>
          </div>
          <Button variant="ghost" size="xs" onClick={logout}
            className="w-full justify-start text-white/35 hover:text-white/70 gap-2 px-1 text-xs">
            <LogOut size={13} /> Sign Out
          </Button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col bg-[#F4F3EF] overflow-hidden">

        {/* Header */}
        <header className="bg-white border-b border-border px-7 py-3.5 flex items-center gap-4 shrink-0">
          <div className="flex-1">
            <p className="font-bold text-base text-foreground">LISSA: Admin Curator</p>
            <p className="text-[11px] text-muted-foreground">AI Student Support Agent Dashboard</p>
          </div>
          <div className="flex items-center gap-2 bg-gray-50 border border-border rounded-lg px-3 py-2 w-56">
            <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 15 15">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              placeholder="Search documents, queries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-xs flex-1 text-foreground placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="relative">
            <button onClick={e => { e.stopPropagation(); setShowDropdown(p => !p); }}
              className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="text-left">
                <p className="text-xs font-semibold text-foreground leading-none">{user?.full_name || "Admin User"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Role: Admin</p>
              </div>
              <ChevronDown size={13} className={cn("text-muted-foreground transition-transform", showDropdown && "rotate-180")} />
            </button>
            {showDropdown && (
              <div className="absolute top-full right-0 mt-2 bg-white border border-border rounded-xl shadow-lg w-44 z-50 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-xs font-semibold text-foreground">{user?.full_name}</p>
                  <p className="text-[10px] text-muted-foreground">Administrator</p>
                </div>
                <button onClick={() => { setShowDropdown(false); logout(); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 transition-colors">
                  <LogOut size={13} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-7">

          {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
          {tab === "overview" && (
            <div>
              <h1 className="text-xl font-bold text-foreground mb-1">Dashboard Overview</h1>
              <p className="text-sm text-muted-foreground mb-6">Monitor and manage the AI Student Support Agent</p>

              <div className="grid grid-cols-4 gap-4 mb-6">
                <StatCard label="Total Indexed Documents" value={stats.indexed.toString()}
                  sub={`${docs.length} total uploaded`} subColor="text-green-600" icon={FileStack} />
                <StatCard label="Avg. Confidence Score" value={stats.avgConf.toFixed(2)}
                  sub={stats.avgConf >= 0.6 ? "↗ Above threshold" : "↘ Below threshold"}
                  subColor={stats.avgConf >= 0.6 ? "text-green-600" : "text-yellow-600"} icon={Target} />
                <StatCard label="Total Queries" value={stats.queries.toString()}
                  sub={`${stats.escalated} escalated`} subColor="text-yellow-600" icon={MessagesSquare} />
                <StatCard label="User Satisfaction"
                  value={stats.queries > 0 ? `${((stats.thumbsUp/stats.queries)*100).toFixed(1)}%` : "N/A"}
                  sub={`${stats.thumbsUp} positive · ${stats.thumbsDown} negative`} subColor="text-green-600" icon={ThumbsUp} />
              </div>

              {/* Document table */}
              <Card className="mb-6 bg-[#FAFAF8]">
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">Document Management</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Manage indexed documents for the knowledge base</p>
                  </div>
                  <Button size="sm" onClick={() => handleTabChange("documents")} className="gap-2 shadow-md" style={{ background: "linear-gradient(135deg, #3D1010 0%, #2D0808 100%)" }}>
                    <Upload size={14} /> Upload Document
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Name</TableHead>
                      <TableHead>Upload Date</TableHead>
                      <TableHead>Ingestion Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docs.slice(0, 6).map(doc => (
                      <TableRow key={doc.doc_id} className="group">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="w-7 h-7 rounded-md bg-red-50 flex items-center justify-center text-sm shrink-0">📄</span>
                            <span className="font-medium text-sm text-foreground truncate max-w-[180px]">{doc.filename}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(doc.created_at).toLocaleDateString("en-PH", { timeZone: MANILA_TIMEZONE, month:"short", day:"numeric", year:"numeric" })}
                        </TableCell>
                        <TableCell><Badge variant={statusVariant(doc.status)} className={cn("border", statusBadgeClass(doc.status))}><span className={cn("w-1.5 h-1.5 rounded-full inline-block mr-1.5", statusDotClass(doc.status))} />{statusLabel(doc.status)}</Badge></TableCell>
                        <TableCell>
                          <button type="button" onClick={() => deleteDoc(doc.doc_id, doc.filename)} title="Delete document" aria-label={`Delete ${doc.filename}`} className="text-red-500 hover:text-red-700 p-1 transition-colors"><Trash2 size={15} /></button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {docs.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-10 text-sm">No documents yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>

              {/* Recent queries */}
              <Card className="bg-[#FAFAF8]">
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">Recent Queries</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Student questions and AI confidence levels</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleTabChange("interactions")}>View All ↗</Button>
                </div>
                <div>
                  {inquiries.slice(0, 6).map(q => (
                    <div key={q.inquiry_id} className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
                      <span className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center text-base shrink-0">💬</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground truncate">{q.question}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(q.created_at)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1.5 justify-end mb-0.5">
                          <div className={cn("w-1.5 h-1.5 rounded-full", q.confidence >= 0.80 ? "bg-green-500" : q.confidence >= 0.50 ? "bg-yellow-500" : "bg-red-500")} />
                          <span className="font-bold text-sm text-foreground">{q.confidence.toFixed(2)}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{confLabel(q.confidence)} Confidence</p>
                      </div>
                    </div>
                  ))}
                  {inquiries.length === 0 && <p className="text-center text-muted-foreground py-10 text-sm">No queries yet.</p>}
                </div>
              </Card>
            </div>
          )}

          {/* ── DOCUMENTS ─────────────────────────────────────────────────── */}
          {tab === "documents" && (
            <div>
              <h1 className="text-xl font-bold text-foreground mb-1">Document Manager</h1>
              <p className="text-sm text-muted-foreground mb-5">Upload and manage knowledge base documents</p>

              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if(f) uploadFile(f); }}
                className={cn("border-2 border-dashed rounded-xl p-10 text-center cursor-pointer bg-white transition-colors mb-5",
                  dragOver ? "border-maroon bg-red-50" : "border-border hover:border-maroon/50")}>
                <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if(f) uploadFile(f); e.target.value=""; }} />
                <p className="text-3xl mb-3">📄</p>
                {uploading ? (
                  <div><p className="font-semibold text-maroon text-sm">Uploading and indexing…</p><p className="text-xs text-muted-foreground mt-1">This may take 10–30 seconds</p></div>
                ) : (
                  <div><p className="font-semibold text-foreground text-sm">Click or drag a PDF to upload</p><p className="text-xs text-muted-foreground mt-1">PDF files only · Student handbook, FAQs, scholarship guidelines</p></div>
                )}
              </div>

              <Card className="bg-[#FAFAF8]">
                <div className="px-6 py-4 border-b border-border">
                  <p className="font-semibold text-foreground">Uploaded Documents ({docs.length})</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Name</TableHead>
                      <TableHead>Upload Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Chunks</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocs.map(doc => (
                      <TableRow key={doc.doc_id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="w-6 h-6 rounded bg-red-50 flex items-center justify-center text-xs shrink-0">📄</span>
                            <span className="font-medium text-sm text-foreground truncate max-w-[160px]">{doc.filename}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(doc.created_at).toLocaleDateString("en-PH", { timeZone: MANILA_TIMEZONE, month:"short", day:"numeric", year:"numeric" })}
                        </TableCell>
                        <TableCell><Badge variant={statusVariant(doc.status)} className={cn("border", statusBadgeClass(doc.status))}><span className={cn("w-1.5 h-1.5 rounded-full inline-block mr-1.5", statusDotClass(doc.status))} />{statusLabel(doc.status)}</Badge></TableCell>
                        <TableCell className="text-muted-foreground text-xs">{doc.chunk_count ?? "—"}</TableCell>
                        <TableCell>
                          <button onClick={() => toggleDoc(doc.doc_id)}
                            className={cn("relative w-9 h-5 rounded-full transition-colors shrink-0", doc.is_active ? "bg-maroon" : "bg-gray-300")}>
                            <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", doc.is_active ? "left-[18px]" : "left-0.5")} />
                          </button>
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => deleteDoc(doc.doc_id, doc.filename)}
                            title="Delete document"
                            aria-label={`Delete ${doc.filename}`}
                            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredDocs.length === 0 && searchQuery && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">
                          No documents match &quot;{searchQuery}&quot;
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredDocs.length === 0 && !searchQuery && docs.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">No documents uploaded yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* ── INTERACTIONS ──────────────────────────────────────────────── */}
          {tab === "interactions" && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h1 className="text-xl font-bold text-foreground mb-1">
                    {searchQuery ? `Interaction Logs (${filteredInquiries.length} of ${inquiries.length})` : "Interaction Logs"}
                  </h1>
                  <p className="text-sm text-muted-foreground">All student questions and LISSA responses</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-1.5">
                    <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
                    {refreshing ? "Refreshing..." : "Refresh"}
                  </Button>
                  <Button variant="destructive" size="sm" disabled={inquiries.length === 0}
                    onClick={async () => {
                      if (!confirm(`Delete all ${inquiries.length} inquiries?`)) return;
                      const r = await fetch("/api/proxy/query/clear", { method:"DELETE", credentials:"include" });
                      if (r.ok) setInquiries([]);
                    }} className="gap-1.5">
                    <Trash2 size={13} /> Clear All
                  </Button>
                </div>
              </div>
              <Card className="bg-[#FAFAF8] overflow-hidden">
                <div className="overflow-x-auto w-full scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Session Title</TableHead>
                        <TableHead>Question</TableHead>
                        <TableHead>Date &amp; Time</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Escalated</TableHead>
                        <TableHead>Feedback</TableHead>
                        <TableHead className="text-right w-[80px]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInquiries.map(q => {
                        const name = studentName(q);
                        return (
                          <TableRow key={q.inquiry_id} className={cn(q.session_id && "border-l-2 border-maroon/40")}>
                            <TableCell>
                              <div className="flex items-center gap-2.5 min-w-[150px]">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="text-[10px]">{studentInitials(name)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="font-semibold text-sm text-foreground truncate max-w-[150px]">{name}</p>
                                  {q.full_name && q.email_address && <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{q.email_address}</p>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[210px]">
                              {q.is_session_start ? <p className="text-sm font-medium text-foreground truncate">{truncateTitle(q.session_title)}</p> : <span className="text-muted-foreground">—</span>}
                              {q.session_size > 1 && <p className="text-[10px] text-muted-foreground mt-0.5">{q.session_size} questions</p>}
                            </TableCell>
                            <TableCell className="max-w-[240px]">
                              <p className="text-sm text-foreground line-clamp-2">{q.question}</p>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTimestamp(q.created_at)}</TableCell>
                            <TableCell><ConfidenceBadge confidence={q.confidence} /></TableCell>
                            <TableCell className="text-center">{q.escalated ? <AlertTriangle size={16} className="mx-auto text-yellow-600" aria-label="Escalated" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-center text-base">{q.feedback === 1 ? "👍" : q.feedback === -1 ? "👎" : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                            <TableCell className="text-right">
                              <button
                                type="button"
                                onClick={() => deleteInquiry(q.inquiry_id, q.question)}
                                disabled={deletingId === q.inquiry_id}
                                className={cn(
                                  "inline-flex items-center gap-1.5 px-2.5 py-1.5",
                                  "text-xs font-medium rounded-md border transition-colors",
                                  deletingId === q.inquiry_id
                                    ? "text-muted-foreground border-border cursor-not-allowed opacity-50"
                                    : "text-red-500 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                                )}
                                title="Delete this inquiry"
                              >
                                {deletingId === q.inquiry_id ? (
                                  <>
                                    <RefreshCw size={11} className="animate-spin" />
                                    Deleting...
                                  </>
                                ) : (
                                  <>
                                    <Trash2 size={11} />
                                    Delete
                                  </>
                                )}
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredInquiries.length === 0 && searchQuery && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-10 text-sm">
                            No interactions match &quot;{searchQuery}&quot;
                          </TableCell>
                        </TableRow>
                      )}
                      {filteredInquiries.length === 0 && !searchQuery && inquiries.length === 0 && (
                        <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10 text-sm">No interactions recorded yet.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}

          {/* ── FEEDBACK ──────────────────────────────────────────────────── */}
          {tab === "feedback" && (
            <div>
              <h1 className="text-xl font-bold text-foreground mb-1">Feedback Analytics</h1>
              <p className="text-sm text-muted-foreground mb-6">Student satisfaction and response quality metrics</p>

              <div className="grid grid-cols-4 gap-4 mb-6">
                <StatCard label="Total Feedback" value={(stats.thumbsUp+stats.thumbsDown).toString()} sub={`of ${stats.queries} total queries`} subColor="text-muted-foreground" icon={BarChart3} />
                <StatCard label="Positive Feedback" value={stats.thumbsUp.toString()} sub={stats.queries > 0 ? `${((stats.thumbsUp/stats.queries)*100).toFixed(1)}%` : "No data"} subColor="text-green-600" icon={ThumbsUp} />
                <StatCard label="Negative Feedback" value={stats.thumbsDown.toString()} sub={stats.queries > 0 ? `${((stats.thumbsDown/stats.queries)*100).toFixed(1)}%` : "No data"} subColor="text-red-600" icon={ThumbsDown} />
                <StatCard label="Escalated" value={stats.escalated.toString()} sub="Flagged for review" subColor="text-yellow-600" icon={AlertTriangle} />
              </div>

              <Card className="mb-5 bg-[#FAFAF8]">
                <div className="px-6 py-4 border-b border-border"><p className="font-semibold text-foreground">Satisfaction Distribution</p></div>
                <div className="px-6 py-5">
                  {(() => {
                    const total = stats.thumbsUp + stats.thumbsDown;
                    const posP  = total > 0 ? (stats.thumbsUp/total)*100 : 0;
                    const negP  = total > 0 ? (stats.thumbsDown/total)*100 : 0;
                    return (
                      <div>
                        <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
                          {total === 0
                            ? <div className="flex-1 bg-gray-100 rounded-full" />
                            : <><div style={{ width:`${posP}%` }} className="bg-green-500 rounded-full" /><div style={{ width:`${negP}%` }} className="bg-red-500 rounded-full" /></>}
                        </div>
                        <div className="flex gap-5">
                          {[["Positive", stats.thumbsUp, "bg-green-500", "text-green-600"],["Negative", stats.thumbsDown, "bg-red-500","text-red-600"]].map(([l,c,bg,tc]) => (
                            <div key={l as string} className="flex items-center gap-2 text-sm text-muted-foreground">
                              <div className={cn("w-2.5 h-2.5 rounded-sm", bg as string)} />
                              {l}: <span className={cn("font-bold", tc as string)}>{c as number}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </Card>

              <Card className="bg-[#FAFAF8]">
                <div className="px-6 py-4 border-b border-border"><p className="font-semibold text-foreground">Queries with Feedback</p></div>
                <div>
                  {inquiries.filter(i => i.feedback !== null).map(q => (
                    <div key={q.inquiry_id} className="flex items-center gap-4 px-6 py-3.5 border-b border-gray-50 last:border-0">
                      <span className="text-xl">{q.feedback === 1 ? "👍" : "👎"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground truncate">{q.question}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(q.created_at)}</p>
                      </div>
                      <ConfidenceBadge confidence={q.confidence} />
                    </div>
                  ))}
                  {inquiries.filter(i => i.feedback !== null).length === 0 && (
                    <p className="text-center text-muted-foreground py-10 text-sm">No feedback recorded yet.</p>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading admin panel...</div>}>
      <AdminContent />
    </Suspense>
  );
}
