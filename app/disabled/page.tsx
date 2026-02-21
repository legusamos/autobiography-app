export const dynamic = "force-dynamic";

export default function DisabledPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full border rounded-xl p-6">
        <h1 className="text-2xl font-semibold">Account Disabled</h1>
        <p className="mt-3 text-sm opacity-80">
          Your account has been disabled by an administrator. If you believe this is an error,
          please contact support.
        </p>
        <p className="mt-4 text-xs opacity-60">
          You have been signed out for security.
        </p>
      </div>
    </div>
  );
}