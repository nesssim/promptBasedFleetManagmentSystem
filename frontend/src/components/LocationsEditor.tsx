import { useEffect, useState } from "react";
import { useUIStore } from "../stores/ui";
import { getLocations, updateLocations, type LocationDef } from "../api";
import { colors } from "../theme";

export function LocationsEditor() {
  const closeLocations = useUIStore((s) => s.closeLocations);
  const [locs, setLocs] = useState<Record<string, LocationDef>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await getLocations();
        setLocs(res.locations);
      } catch {
        setError("Failed to load locations");
      }
      setLoading(false);
    })();
  }, []);

  const addRow = () => {
    setNewName("");
    setNameError("");
    setShowNameInput(true);
  };

  const confirmAddRow = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (locs[trimmed]) {
      setNameError("Location already exists");
      return;
    }
    setLocs((prev) => ({ ...prev, [trimmed]: { x: 0, y: 0 } }));
    setShowNameInput(false);
    setNewName("");
    setNameError("");
  };

  const removeRow = (name: string) => {
    setLocs((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const update = (name: string, field: "x" | "y", val: string) => {
    const n = parseFloat(val);
    setLocs((prev) => ({ ...prev, [name]: { ...prev[name], [field]: isNaN(n) ? 0 : n } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateLocations({ locations: locs });
      closeLocations();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    }
    setSaving(false);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.title}>Yard Locations</h2>
          <button style={styles.closeBtn} onClick={closeLocations}>&times;</button>
        </div>

        {loading && <p style={styles.muted}>Loading...</p>}
        {error && <p style={styles.error}>{error}</p>}

        {!loading && (
          <div style={styles.body}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>X</th>
                  <th style={styles.th}>Y</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(locs).map(([name, loc]) => (
                  <tr key={name}>
                    <td style={styles.td}><code>{name}</code></td>
                    <td style={styles.td}>
                      <input style={styles.input} type="number" step="0.5"
                        value={loc.x} onChange={(e) => update(name, "x", e.target.value)} />
                    </td>
                    <td style={styles.td}>
                      <input style={styles.input} type="number" step="0.5"
                        value={loc.y} onChange={(e) => update(name, "y", e.target.value)} />
                    </td>
                    <td style={styles.td}>
                      <button style={styles.removeBtn} onClick={() => removeRow(name)}>&times;</button>
                    </td>
                  </tr>
                ))}
                {showNameInput && (
                  <tr>
                    <td style={styles.td}>
                      <input
                        style={{ ...styles.input, borderColor: nameError ? colors.danger : colors.border.default }}
                        type="text"
                        placeholder="e.g. warehouse"
                        value={newName}
                        onChange={(e) => { setNewName(e.target.value); setNameError(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmAddRow(); if (e.key === "Escape") setShowNameInput(false); }}
                        autoFocus
                      />
                      {nameError && <div style={{ color: colors.danger, fontSize: 10, marginTop: 2 }}>{nameError}</div>}
                    </td>
                    <td style={styles.td}></td>
                    <td style={styles.td}></td>
                    <td style={styles.td}>
                      <button style={styles.confirmBtn} onClick={confirmAddRow}>&#10003;</button>
                      <button style={styles.cancelAddBtn} onClick={() => setShowNameInput(false)}>&times;</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button style={styles.addBtn} onClick={addRow}>+ Add Location</button>
            <div style={styles.footer}>
              <button style={styles.cancelBtn} onClick={closeLocations}>Cancel</button>
              <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
    zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
  },
  panel: {
    width: 500, maxHeight: "80vh", background: colors.surface.default, borderRadius: 12,
    boxShadow: "0 8px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", overflow: "hidden",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 24px", borderBottom: `1px solid ${colors.border.default}`,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 700 },
  closeBtn: {
    background: "none", border: "none", fontSize: 24, cursor: "pointer",
    color: colors.text.muted, padding: "4px 8px", lineHeight: 1,
  },
  body: { padding: 16, overflowY: "auto", flex: 1 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left", fontSize: 11, fontWeight: 600, color: colors.text.muted,
    padding: "6px 8px", borderBottom: `2px solid ${colors.border.default}`, textTransform: "uppercase",
  },
  td: { padding: "4px 8px", borderBottom: `1px solid ${colors.border.light}` },
  input: {
    width: "100%", padding: "4px 6px", border: `1px solid ${colors.border.default}`,
    borderRadius: 4, fontSize: 13, boxSizing: "border-box",
  },
  removeBtn: {
    background: "none", border: "none", color: colors.danger,
    cursor: "pointer", fontSize: 16, padding: "2px 6px",
  },
  confirmBtn: {
    background: colors.primary, color: colors.primaryForeground, border: "none",
    borderRadius: 4, cursor: "pointer", fontSize: 14, padding: "2px 8px", marginRight: 4,
  },
  cancelAddBtn: {
    background: "none", border: "none", color: colors.text.muted,
    cursor: "pointer", fontSize: 16, padding: "2px 6px",
  },
  addBtn: {
    marginTop: 12, background: colors.surface.subtle, border: `1px dashed ${colors.border.default}`,
    borderRadius: 6, padding: "8px 16px", cursor: "pointer",
    fontSize: 13, color: colors.text.secondary, width: "100%",
  },
  footer: {
    display: "flex", justifyContent: "flex-end", gap: 8,
    marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.border.default}`,
  },
  cancelBtn: {
    background: "transparent", border: `1px solid ${colors.border.default}`,
    borderRadius: 6, padding: "8px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer",
  },
  saveBtn: {
    background: colors.primary, color: colors.primaryForeground, border: "none",
    borderRadius: 6, padding: "8px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer",
  },
  error: { color: colors.danger, fontSize: 13, padding: 8 },
  muted: { color: colors.text.faint, fontSize: 14 },
};
