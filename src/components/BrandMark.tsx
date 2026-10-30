type BrandMarkProps = {
  className?: string;
  decorative?: boolean;
};

export function BrandMark({ className = "", decorative = false }: BrandMarkProps) {
  return (
    // The mark is a static brand asset; bypassing image optimization keeps favicons and tiny UI marks crisp.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/harmonia-mark.png"
      alt={decorative ? "" : "Harmonia"}
      aria-hidden={decorative || undefined}
      className={className}
    />
  );
}
