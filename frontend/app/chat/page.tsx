"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Plus, Settings, LogOut, Menu, Send, Lock, Phone, BookOpen, ClipboardList, Trash2, MessagesSquare } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Message {
  id: string; role: "user" | "assistant"; content: string;
  isStreaming?: boolean; confidence?: number; confidence_label?: string;
  source_filename?: string; inquiry_id?: string; escalated?: boolean;
}
interface SessionInquiry {
  inquiry_id: string; question: string; answer: string;
  confidence: number; source_filename: string | null;
  escalated: boolean; feedback: number | null; created_at: string;
}
interface Session {
  session_id: string | null; title: string;
  count: number; created_at: string; inquiries: SessionInquiry[];
}
interface User { full_name: string; role_id: string; }

const QUICK_ACTIONS = [
  { label: "Get In Touch", query: "How can I contact the university offices?", Icon: Phone },
  { label: "Liceo VMGO",  query: "What is the vision mission goals and objectives of Liceo de Cagayan University?", Icon: BookOpen },
  { label: "Enrollment",  query: "What are the enrollment requirements?", Icon: ClipboardList },
];

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

function generateSessionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function groupSessionsByDate(sessions: Session[]) {
  const nowInManila = new Date().toLocaleString("en-US", { timeZone: MANILA_TIMEZONE });
  const now = new Date(nowInManila);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest = new Date(today.getTime() - 86400000);
  const week = new Date(today.getTime() - 7 * 86400000);
  const g: Record<string, Session[]> = { "Today": [], "Yesterday": [], "This Week": [], "Older": [] };
  sessions.forEach((s) => {
    const sessionInManila = new Date(s.created_at).toLocaleString("en-US", { timeZone: MANILA_TIMEZONE });
    const sessionDate = new Date(sessionInManila);
    const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
    if (sessionDay >= today) g["Today"].push(s);
    else if (sessionDay >= yest) g["Yesterday"].push(s);
    else if (sessionDay >= week) g["This Week"].push(s);
    else g["Older"].push(s);
  });
  return g;
}

function confBadgeVariant(label?: string): "high" | "medium" | "low" | "scope" {
  if (label === "out_of_scope") return "scope";
  if (label === "high")         return "high";
  if (label === "medium")       return "medium";
  return "low";
}

export default function ChatPage() {
  const router = useRouter();
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState("");
  const [loading,        setLoading]        = useState(false);
  const [user,           setUser]           = useState<User | null>(null);
  const [sessions,       setSessions]       = useState<Session[]>([]);
  const [activeSession,  setActiveSession]  = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<string>(generateSessionId);
  const [feedbackGiven,  setFeedbackGiven]  = useState<Set<string>>(new Set());
  const [searchQuery,    setSearchQuery]    = useState("");
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(async () => {
    const r = await fetch("/api/proxy/query/my-sessions", { credentials: "include" });
    if (r.ok) setSessions(await r.json());
  }, []);

  useEffect(() => {
    fetch("/api/proxy/auth/me", { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setUser)
      .catch(() => router.push("/login"));
    loadSessions();
  }, [router, loadSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSession = (session: Session) => {
    setActiveSession(session.session_id);
    setCurrentSession(session.session_id || generateSessionId());
    const msgs: Message[] = [];
    const sorted = [...session.inquiries].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    sorted.forEach((inq) => {
      msgs.push({ id: `u-${inq.inquiry_id}`, role: "user", content: inq.question });
      msgs.push({
        id: inq.inquiry_id, role: "assistant", content: inq.answer,
        confidence: inq.confidence,
        confidence_label: inq.confidence <= 0 && inq.answer.includes("only able to answer")
          ? "out_of_scope" : inq.confidence >= 0.80 ? "high" : inq.confidence >= 0.50 ? "medium" : "low",
        source_filename: inq.source_filename ?? undefined,
        inquiry_id: inq.inquiry_id, escalated: inq.escalated,
      });
    });
    setMessages(msgs);
  };

  const newChat = () => {
    setMessages([]); setActiveSession(null);
    setCurrentSession(generateSessionId()); setInput("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const sendMessage = async (question?: string) => {
    const text = (question || input).trim();
    if (!text || loading) return;
    setInput(""); setLoading(true);
    setMessages((p) => [...p, { id: `u-${Date.now()}`, role: "user", content: text }]);
    const streamId = `streaming-${Date.now()}`;
    setMessages((p) => [...p, { id: streamId, role: "assistant", content: "", isStreaming: true }]);
    try {
      const res = await fetch("/api/proxy/query/stream", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, session_id: currentSession }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.token !== undefined) {
              setMessages((p) => p.map((m) => m.id === streamId ? { ...m, content: m.content + parsed.token } : m));
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }
            if (parsed.done) {
              setMessages((p) => p.map((m) => m.id === streamId ? {
                ...m, id: parsed.inquiry_id, isStreaming: false,
                inquiry_id: parsed.inquiry_id, confidence: parsed.confidence,
                confidence_label: parsed.confidence_label,
                source_filename: parsed.source_filename, escalated: parsed.escalated,
              } : m));
              setActiveSession(parsed.session_id || currentSession);
              loadSessions();
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) {
      setMessages((p) => p.map((m) => m.id === streamId
        ? { ...m, content: err instanceof Error ? err.message : "An error occurred.", isStreaming: false } : m));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const submitFeedback = async (id: string, vote: number) => {
    if (feedbackGiven.has(id)) return;
    await fetch(`/api/proxy/query/${id}/feedback`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote }),
    });
    setFeedbackGiven((p) => new Set(p).add(id));
  };

  const logout = async () => {
    await fetch("/api/proxy/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  };

  const filtered   = sessions.filter(s => searchQuery === "" || s.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const grouped    = groupSessionsByDate(filtered);
  const groupOrder = ["Today", "Yesterday", "This Week", "Older"];
  const initials   = user?.full_name?.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "S";

  return (
    <div className="flex h-screen overflow-hidden font-sans">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <aside className="w-72 sidebar-gradient flex flex-col shrink-0 overflow-hidden">

          {/* Logo row */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <h1 className="font-serif font-bold italic text-2xl text-white tracking-wide">Ask LISSA</h1>
            <button onClick={() => setSidebarOpen(false)} className="text-gold hover:opacity-75 transition-opacity p-1">
              <Menu size={20} />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 input-glass rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-white/40 shrink-0" fill="none" viewBox="0 0 15 15">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search...."
                className="input-glass flex-1 text-sm bg-transparent border-none outline-none" />
            </div>
          </div>

          {/* Nav */}
          <nav className="px-3 pb-2 flex flex-col gap-0.5">
            <Button variant="sidebar" size="sm" onClick={newChat}>
              <Plus size={16} /> New Chat
            </Button>
          </nav>

          <Separator className="mx-4 mb-3 bg-white/10" />

          {/* Session history */}
          <ScrollArea className="flex-1 px-3">
            <p className="text-[10px] font-semibold text-white/35 uppercase tracking-widest px-2 pb-2">
              Recent Chats
            </p>

            {sessions.length === 0 && (
              <div className="flex flex-col gap-2 px-2 pt-1">
                {[120, 95, 140, 80].map((w, i) => (
                  <div key={i} className="h-0.5 rounded-full bg-white/10" style={{ width: w }} />
                ))}
              </div>
            )}

            {groupOrder.map((group) => {
              const items = grouped[group];
              if (!items || items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider px-2 pt-3 pb-1">{group}</p>
                  {items.map((session) => {
                    const isActive = activeSession === session.session_id;
                    return (
                      <div key={session.session_id || "null"}
                        className={cn(
                          "group w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg mb-0.5 transition-colors",
                          isActive ? "bg-white/[0.12]" : "hover:bg-white/[0.07]"
                        )}>
                        <button type="button" onClick={() => loadSession(session)} className="flex flex-1 min-w-0 items-start gap-2.5 text-left">
                          <MessagesSquare
                            size={14}
                            className="text-white/45 shrink-0 mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-xs leading-snug truncate", isActive ? "text-gold font-medium" : "text-white/80")}>
                              {session.title.length > 38 ? session.title.slice(0, 38) + "…" : session.title}
                            </p>
                            <p className="text-[10px] text-white/30 mt-0.5">
                              {session.count} {session.count === 1 ? "question" : "questions"} · {formatSessionTime(session.created_at)}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm("Delete this conversation? This cannot be undone.")) return;
                            const r = await fetch(
                              `/api/proxy/query/sessions/${session.session_id}`,
                              { method: "DELETE", credentials: "include" }
                            );
                            if (r.ok) {
                              setSessions(prev => prev.filter(s => s.session_id !== session.session_id));
                              if (activeSession === session.session_id) {
                                setMessages([]);
                                setActiveSession(null);
                                setCurrentSession(generateSessionId());
                              }
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/20 text-white/50 hover:text-red-400 shrink-0"
                          title="Delete conversation"
                          aria-label="Delete conversation"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="h-4" />
          </ScrollArea>

          {/* Bottom */}
          <div className="px-3 pt-2 pb-4 border-t border-white/10 mt-2">
            <Button variant="sidebar" size="sm" className="mb-1">
              <Settings size={15} />
              <span className="italic">Settings &amp; Help</span>
            </Button>

            <div className="flex items-center gap-2.5 px-3 py-1.5 mt-1">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-[11px] bg-gold text-maroon font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white font-medium truncate">{user?.full_name || "Student"}</p>
                <p className="text-[10px] text-white/35 capitalize">{user?.role_id}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}
              className="w-full justify-start text-white/35 hover:text-white/70 px-3 mt-0.5 text-xs gap-2">
              <LogOut size={13} /> Sign out
            </Button>
          </div>
        </aside>
      )}

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-3.5 border-b border-border shrink-0">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground hover:text-foreground transition-colors mr-1">
              <Menu size={20} />
            </button>
          )}
          <p className="flex-1 text-sm text-muted-foreground">
            {activeSession
              ? `Session · ${sessions.find(s => s.session_id === activeSession)?.count || ""} questions`
              : "New conversation"}
          </p>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col justify-center max-w-2xl pb-16">
              <div className="flex items-center gap-4 mb-5">
                <img src="/ldcu-crest.png" alt="LdCU" className="w-11 h-11 object-contain"
                  onError={(e) => { (e.target as HTMLElement).style.display = "none"; }} />
                <p className="italic text-base text-foreground font-medium">
                  Hello! {user?.full_name?.split(" ")[0] || "Student"}
                </p>
              </div>
              <h2 className="font-serif font-bold italic text-3xl text-foreground mb-7 leading-snug">
                How can I make things a bit easier for you today?
              </h2>
              <div className="flex flex-wrap gap-3">
                {QUICK_ACTIONS.map(({ label, query, Icon }) => (
                  <button key={label} onClick={() => sendMessage(query)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-transparent border-[1.5px] border-[rgba(201,160,48,0.4)] text-[#1A1A1A] rounded-xl text-sm font-sans font-semibold not-italic hover:bg-gold/10 hover:border-gold hover:text-maroon transition-colors">
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          <div className="flex flex-col gap-5">
            {messages.map((msg) => (
              <div key={msg.id}
                className={cn("flex items-end gap-3 message-in", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>

                {msg.role === "assistant" && (
                  <Avatar className="h-7 w-7 shrink-0 mb-0.5">
                    <AvatarFallback className="text-[11px] bg-maroon text-gold font-bold">L</AvatarFallback>
                  </Avatar>
                )}

                <div className="max-w-xl flex flex-col gap-1.5">
                  {/* Bubble */}
                  <div className={cn(
                    "px-4 py-3 text-sm leading-relaxed relative",
                    msg.role === "user"
                      ? "bg-maroon text-white rounded-[18px_18px_4px_18px]"
                      : "bg-gray-100 text-foreground rounded-[18px_18px_18px_4px]"
                  )}>
                    {msg.role === "assistant" ? (
                      <ReactMarkdown
                        className="prose prose-sm max-w-none text-foreground prose-headings:font-semibold prose-headings:text-foreground prose-strong:font-semibold prose-strong:text-foreground prose-ol:pl-4 prose-ul:pl-4 prose-li:my-0.5 prose-p:my-1 prose-p:leading-relaxed"
                        components={{
                          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>,
                          ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5">{children}</ul>,
                          li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-maroon">{children}</strong>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : msg.content}
                    {msg.isStreaming && <span className="streaming-cursor" />}
                  </div>

                  {/* Metadata */}
                  {msg.role === "assistant" && !msg.isStreaming && msg.confidence !== undefined && (() => {
                    const isOutScope = msg.confidence_label === "out_of_scope";
                    return (
                      <div className="pl-1 flex flex-col gap-1.5">
                        {isOutScope && (
                          <Badge variant="scope" className="self-start">
                            <Lock size={10} /> Out of LISSA&apos;s scope
                          </Badge>
                        )}
                        {msg.inquiry_id && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">Helpful?</span>
                            {feedbackGiven.has(msg.inquiry_id) ? (
                              <span className="text-[11px] text-muted-foreground">Thanks!</span>
                            ) : (
                              <>
                                <button onClick={() => submitFeedback(msg.inquiry_id!, 1)} className="text-sm hover:scale-110 transition-transform">👍</button>
                                <button onClick={() => submitFeedback(msg.inquiry_id!, -1)} className="text-sm hover:scale-110 transition-transform">👎</button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input bar */}
        <div className="bg-[#2A2A2A] px-4 py-3 shrink-0 border-t border-white/10">
          <div className="flex items-end gap-3 bg-[#3A3A3A] rounded-xl px-4 py-3 border border-white/10 focus-within:border-white/25 transition-colors">
            <div className="w-px h-5 bg-white/20 shrink-0 mb-0.5" />
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !loading) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask LISSA"
              disabled={loading}
              rows={1}
              className="flex-1 bg-transparent border-none outline-none ring-0 focus-visible:ring-0 shadow-none text-white/85 placeholder:text-white/35 text-sm font-sans py-0 px-0 resize-none min-h-[24px] max-h-[160px] leading-6"
              autoFocus
            />
            <Button
              variant="gold"
              size="sm"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="px-4 shrink-0 self-end">
              <Send size={14} />
              Send
            </Button>
          </div>
          <p className="text-center text-[11px] text-white/30 mt-2">
            LISSA may occasionally provide inaccurate information. Always verify important details with the university office.
          </p>
        </div>
      </div>
    </div>
  );
}
