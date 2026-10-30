import Image from "next/image";

/** Identidade compartilhada entre login e navegação, preservando a logo original. */
export function AppBrand() {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Image
        src="/brand/mts.png"
        alt=""
        width={48}
        height={48}
        className="h-12 w-12 shrink-0 rounded-md"
      />
      <span className="min-w-0">
        <span className="block text-lg font-semibold text-slate-900">MTS</span>
        <span className="block text-xs text-slate-500">MT Serviços</span>
      </span>
    </span>
  );
}
