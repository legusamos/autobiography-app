import { Suspense } from "react";
import WeekClient from "./WeekClient";

export default function WeekPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <WeekClient />
    </Suspense>
  );
}