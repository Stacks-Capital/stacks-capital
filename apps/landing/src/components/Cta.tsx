/**
 * A call to action whose destination may not exist yet.
 *
 * Marketing pages collect links before the pages they point at are built. Rendering those as an
 * anchor to "#" looks like a link and behaves like nothing, so anything without a destination is a
 * button instead: present, styled the same, and honest about going nowhere.
 */
export function Cta({
  href,
  className,
  onSelect,
  children,
}: {
  href: string | null;
  className: string;
  onSelect?: () => void;
  children: React.ReactNode;
}) {
  if (href === null) {
    return (
      <button type="button" className={className} onClick={onSelect}>
        {children}
      </button>
    );
  }
  return (
    <a href={href} className={className} onClick={onSelect}>
      {children}
    </a>
  );
}
