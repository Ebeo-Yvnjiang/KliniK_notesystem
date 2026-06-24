export function SearchHighlight({
  text,
  start,
  length,
}: {
  text: string;
  start: number;
  length: number;
}) {
  if (start < 0 || length <= 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + length)}</mark>
      {text.slice(start + length)}
    </>
  );
}
