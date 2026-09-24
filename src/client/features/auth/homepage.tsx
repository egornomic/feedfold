import { useState } from "react";
import type { SessionUser } from "../../../shared/types";
import { appUrl } from "../../api/api";
import { BrandIdentity } from "../../ui/brand";
import { AuthLegalLinks, LoginDialog } from "./auth";
import "./homepage.css";

const points = [
  "add rss feeds and x posts, sync youtube subscriptions",
  "filter out shorts and other noise",
  "read a feed you can finish",
];

export function Homepage({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [loginOpen, setLoginOpen] = useState(
    () => window.location.pathname.replace(/\/$/, "") !== appUrl("/").replace(/\/$/, ""),
  );

  return (
    <>
      <div className="homepage">
        <main className="homepage-content">
          <header className="homepage-header">
            <h1>
              <BrandIdentity />
            </h1>
            <button
              className="homepage-sign-in"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setLoginOpen(true)}
            >
              i'm in
            </button>
          </header>
          <ul className="homepage-points" aria-label="What feedfold does">
            {points.map((point) => (
              <li key={point}>
                <svg className="homepage-cube" viewBox="0 0 18 18" aria-hidden="true">
                  <rect width="18" height="18" rx="4" />
                </svg>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </main>
        <footer className="homepage-footer">
          <AuthLegalLinks />
        </footer>
      </div>
      {loginOpen ? (
        <LoginDialog onAuthenticated={onAuthenticated} onDismiss={() => setLoginOpen(false)} />
      ) : null}
    </>
  );
}
