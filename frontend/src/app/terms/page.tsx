import { PublicFooter } from "@/components/public-footer";
import { PublicNavbar } from "@/components/public-navbar";

export const metadata = { title: "Terms of Service - VDaAgent" };

export default function TermsPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main className="pub-section" style={{ flex: 1 }}>
        <div className="pub-container" style={{ maxWidth: "900px" }}>
          <span className="pub-eyebrow">TERMS OF SERVICE</span>
          <h1>Terms of Service</h1>
          <p className="lead">Effective date: August 25, 2026</p>
          <div style={{ display: "grid", gap: "28px", marginTop: "36px", lineHeight: 1.7 }}>
            <section><h2>1. Acceptance</h2><p>By accessing or using VDaAgent, you confirm that you have read and accept these terms. If you use the service for an organization, you confirm that you are authorized to represent it.</p></section>
            <section><h2>2. Acceptable use</h2><p>You may use VDaAgent only for lawful purposes and only with data you are authorized to process. You must protect your credentials and must not bypass authentication, authorization, query limits, or security controls.</p></section>
            <section><h2>3. Data analysis and Agent output</h2><p>Profiling results and Agent responses are provided to support analysis and do not replace professional review or business decisions. You are responsible for checking the evidence, data scope, and suitability of any result before relying on it.</p></section>
            <section><h2>4. Google Calendar</h2><p>Calendar actions are available only after an Analyst connects a Google account and grants the required permission. Before creating or deleting an event, you are responsible for confirming the correct calendar, time, and content. You may disconnect Google Calendar at any time.</p></section>
            <section><h2>5. Ownership</h2><p>You retain rights to the data you provide. VDaAgent and its components belong to their respective owners or licensors. You grant VDaAgent the limited permission needed to store and process your data to provide requested features.</p></section>
            <section><h2>6. Availability and liability</h2><p>The service may be changed, maintained, or temporarily unavailable for technical, security, or legal reasons. To the extent permitted by law, VDaAgent is not responsible for losses caused by relying on unverified output or by third-party accounts and services under your control.</p></section>
            <section><h2>7. Changes</h2><p>We may update these terms to reflect product or legal changes. The latest version will be published on this page with its effective date. Continued use after that date means you accept the updated terms.</p></section>
            <section><h2>8. Contact</h2><p>For support, use our <a href="/contact">Contact</a> page or the contact information published by the organization deploying VDaAgent.</p></section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
