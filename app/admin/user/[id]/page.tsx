import UserClient from "./UserClient";

function isUuid(v: any): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type ParamsMaybePromise = { id: string } | Promise<{ id: string }>;

export default async function AdminUserPage({
  params,
}: {
  params: ParamsMaybePromise;
}) {
  // Newer Next versions may pass params as a Promise
  const resolved = await Promise.resolve(params);
  const id = resolved?.id;

  if (!isUuid(id)) {
    return (
      <div className="p-6">
        <div className="text-xl font-semibold">Invalid user id</div>
        <div className="mt-2 text-sm opacity-80">
          The URL parameter was: <span className="font-mono">{String(id)}</span>
        </div>
        <div className="mt-2 text-sm opacity-80">
          Go back to Admin and click View again.
        </div>
      </div>
    );
  }

  return <UserClient userId={id} />;
}