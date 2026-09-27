export function Wordmark({ size = "text-[22px]" }: { size?: string }) {
  return (
    <span className={`${size} font-extrabold text-paper`}>
      stacks<span className="text-orange">.</span>capital
    </span>
  );
}
