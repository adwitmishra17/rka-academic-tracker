// =========================================================================
// MyDocuments.jsx
//
// Teacher-facing document list for the rka-teacher PWA.
//
// Calls the Supabase Edge Function `get-my-documents` with the user's
// Firebase ID token to fetch the list, and `presign-my-document-download`
// per click to get a short-lived signed R2 URL.
//
// Drop-in expectations:
//   - Firebase Auth initialised at src/firebase/config.js (auth export)
//   - Vite env var VITE_SUPABASE_FUNCTIONS_URL points at the Edge Functions URL
//   - Route wired in App.jsx: <Route path="hrms/documents" element={<MyDocuments />} />
// =========================================================================

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "../firebase/config";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

const IST_TZ = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default function MyDocuments() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [openingId, setOpeningId] = useState(null); // id currently being signed

  // Fetch list on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not signed in");

        async function callOnce() {
          const token = await user.getIdToken(/* forceRefresh */ true);
          return fetch(`${FUNCTIONS_URL}/get-my-documents`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });
        }

        let res;
        try {
          res = await callOnce();
        } catch (err) {
          console.warn('get-my-documents first attempt failed, retrying:', err?.message);
          await new Promise(r => setTimeout(r, 600));
          res = await callOnce();
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || `Server returned ${res.status}`);
        }
        if (cancelled) return;
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
      } catch (e) {
        console.error('get-my-documents failed permanently:', e);
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Click-to-view: ask for a signed URL, then open it
  async function handleView(docId) {
    setOpeningId(docId);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");

      async function callOnce() {
        const token = await user.getIdToken(/* forceRefresh */ true);
        return fetch(`${FUNCTIONS_URL}/presign-my-document-download`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ documentId: docId }),
        });
      }

      let res;
      try {
        res = await callOnce();
      } catch (err) {
        console.warn('presign-my-document-download first attempt failed, retrying:', err?.message);
        await new Promise(r => setTimeout(r, 600));
        res = await callOnce();
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.downloadUrl) {
        throw new Error(data.message || data.error || `Server returned ${res.status}`);
      }

      // Open in new tab. Browsers render PDFs and images inline; other
      // types will prompt download.
      window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert("Couldn't open document: " + (e.message || String(e)));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <Link to="/hrms" style={backLinkStyle}>&larr; Back to HRMS</Link>
        <h1 style={titleStyle}>My Documents</h1>
        <p style={subtitleStyle}>Your employment records on file</p>
      </div>

      {loading && <div style={messageStyle}>Loading…</div>}

      {error && (
        <div style={errorStyle}>
          <strong>Couldn't load documents</strong>
          <div style={{ marginTop: 6, fontSize: 13 }}>{error}</div>
        </div>
      )}

      {!loading && !error && documents.length === 0 && (
        <div style={messageStyle}>
          No documents on file yet. Your admin will upload your records
          (appointment letter, joining letter, etc.) once they're ready.
        </div>
      )}

      {!loading && !error && documents.length > 0 && (
        <ul style={listStyle}>
          {documents.map((d) => (
            <li key={d.id} style={itemStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={fileNameStyle} title={d.filename}>
                  {d.filename}
                </div>
                {d.created_at && (
                  <div style={fileMetaStyle}>
                    Uploaded {dateFmt.format(new Date(d.created_at))}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleView(d.id)}
                disabled={openingId === d.id}
                style={{
                  ...viewButtonStyle,
                  opacity: openingId === d.id ? 0.6 : 1,
                  cursor: openingId === d.id ? "wait" : "pointer",
                }}
              >
                {openingId === d.id ? "Opening…" : "View"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- inline styles (matches MyAttendance pattern — no separate CSS file) ----

const containerStyle = {
  maxWidth: 600,
  margin: "0 auto",
  padding: "16px 16px 80px",
};

const headerStyle = {
  marginBottom: 20,
};

const backLinkStyle = {
  display: "inline-block",
  fontSize: 13,
  color: "#1a4a2e",
  textDecoration: "none",
  marginBottom: 12,
};

const titleStyle = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 28,
  fontWeight: 600,
  color: "#1a4a2e",
  margin: "0 0 4px 0",
  lineHeight: 1.2,
};

const subtitleStyle = {
  fontSize: 13,
  color: "#6b6b6b",
  margin: 0,
};

const messageStyle = {
  padding: "32px 16px",
  textAlign: "center",
  color: "#6b6b6b",
  fontSize: 14,
  background: "#fafaf7",
  border: "1px solid #e8e6dc",
  borderRadius: 8,
};

const errorStyle = {
  padding: "16px",
  color: "#8b1a1a",
  background: "#fdecec",
  border: "1px solid #f5c7c7",
  borderRadius: 8,
  fontSize: 14,
};

const listStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const itemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 16px",
  background: "#fff",
  border: "1px solid #e8e6dc",
  borderRadius: 8,
};

const fileNameStyle = {
  fontSize: 14,
  fontWeight: 500,
  color: "#1f2937",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const fileMetaStyle = {
  fontSize: 11.5,
  color: "#6b6b6b",
  marginTop: 4,
};

const viewButtonStyle = {
  background: "#1a4a2e",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: "nowrap",
};
