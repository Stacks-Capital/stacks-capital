export function SectionHeading({
  eyebrow,
  eyebrowColor,
  title,
  body,
  width = 640,
  onDark = false,
}: {
  eyebrow: string;
  eyebrowColor: string;
  title: React.ReactNode;
  body?: string;
  /** The handoff fixes this per section, at 620px or 640px. */
  width?: 620 | 640;
  onDark?: boolean;
}) {
  return (
    <div className="mb-10" style={{ maxWidth: `${width}px` }}>
      <p className="mb-3 text-[13px] font-extrabold tracking-[0.1em] uppercase" style={{ color: eyebrowColor }}>
        {eyebrow}
      </p>
      <h2
        className={`display m-0 text-[clamp(28px,3.4vw,40px)] leading-[1.15] font-black ${
          body ? "mb-4" : ""
        } ${onDark ? "text-paper" : ""}`}
      >
        {title}
      </h2>
      {body ? (
        <p className={`m-0 text-base leading-relaxed ${onDark ? "text-paper/65" : "text-ink/65"}`}>{body}</p>
      ) : null}
    </div>
  );
}
