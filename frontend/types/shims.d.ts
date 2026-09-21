declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'next/navigation' {
  export function useRouter(): any;
  export function usePathname(): string | null;
  export function useSearchParams(): any;
}
