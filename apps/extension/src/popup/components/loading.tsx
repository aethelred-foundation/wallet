export function Loading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <p>{message}</p>
    </div>
  );
}
