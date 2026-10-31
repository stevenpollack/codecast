"use client";
import { AuthGuard } from "../../components/AuthGuard";
import { DashboardLayout } from "../../components/DashboardLayout";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { PromptsPage } from "../../components/prompts/PromptsPage";

// The Prompts page: a day of what each person typed into sessions (components/prompts/PromptsPage).
export default function PromptsRoute() {
  return (
    <AuthGuard>
      <DashboardLayout>
        <ErrorBoundary name="Prompts" level="panel">
          <PromptsPage />
        </ErrorBoundary>
      </DashboardLayout>
    </AuthGuard>
  );
}
