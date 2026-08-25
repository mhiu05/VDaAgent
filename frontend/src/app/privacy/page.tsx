import { PublicFooter } from "@/components/public-footer";
import { PublicNavbar } from "@/components/public-navbar";

export const metadata = { title: "Privacy Policy - VDaAgent" };

export default function PrivacyPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main className="pub-section" style={{ flex: 1 }}>
        <div className="pub-container" style={{ maxWidth: "900px" }}>
          <span className="pub-eyebrow">PRIVACY POLICY</span>
          <h1>Privacy Policy</h1>
          <p className="lead">Effective date: August 25, 2026</p>
          <div style={{ display: "grid", gap: "28px", marginTop: "36px", lineHeight: 1.7 }}>
            <section><h2>1. Scope</h2><p>This policy describes how VDaAgent collects, uses, and protects information when you use our data profiling and analysis platform.</p></section>
            <section><h2>2. Information we process</h2><p>We may process account and workspace information, dataset metadata, profiling results, activity history, and conversations with the Agent as needed to provide the service. VDaAgent is designed to limit exposure of raw rows and unnecessary personal data.</p></section>
            <section><h2>3. Google Calendar</h2><p>If an Analyst chooses to connect Google Calendar, the application uses the granted permission to view, create, and delete events in the selected calendar. Refresh tokens are encrypted on the backend. Client secrets and tokens are never placed in the frontend.</p><p>You can disconnect VDaAgent or revoke access from your Google account settings. After disconnecting, calendar actions are unavailable until you authorize the application again.</p></section>
            <section><h2>4. Use and retention</h2><p>Information is used to operate, secure, support, and improve the service. Data is retained for as long as needed for the workspace or as configured by the deploying organization, then deleted or anonymized when appropriate.</p></section>
            <section><h2>5. Security and third parties</h2><p>We use authentication, workspace-level authorization, and appropriate encryption controls. Some features use infrastructure providers or Google APIs; those providers process information under their own policies.</p></section>
            <section><h2>6. Contact</h2><p>For privacy questions or data requests, use our <a href="/contact">Contact</a> page or the contact information published by the organization deploying VDaAgent.</p></section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
