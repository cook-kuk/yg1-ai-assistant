// Retry the 2 hung basic cases against :3000 to confirm cold-start vs real bug
const API_URL = "http://localhost:3000/api/recommend";
const cases = [
  { name: "P + 10mm + Milling", form: {
    material: { status: "known", value: "P" },
    diameterInfo: { status: "known", value: "10mm" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  }},
  { name: "M + 6mm + Drilling", form: {
    material: { status: "known", value: "M" },
    diameterInfo: { status: "known", value: "6mm" },
    toolTypeOrCurrentProduct: { status: "known", value: "Drilling" },
  }},
];
function makeForm(partial) {
  const empty = { status: "unknown", value: "" };
  return {
    material: empty, diameterInfo: empty, toolTypeOrCurrentProduct: empty,
    operationType: empty, holeDepth: empty, fluteCountInfo: empty,
    coatingInfo: empty, country: { status: "known", value: "ALL" },
    ...partial,
  };
}
for (const tc of cases) {
  const t0 = Date.now();
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intakeForm: makeForm(tc.form), messages: [], session: null, language: "ko" }),
    });
    const j = await res.json();
    const ms = Date.now() - t0;
    console.log(`${tc.name}: HTTP=${res.status} time=${ms}ms candidateCount=${j?.session?.publicState?.candidateCount} error=${j?.error ?? "none"} textLen=${(j?.text??"").length}`);
  } catch (e) {
    console.log(`${tc.name}: ERR ${e.message}`);
  }
}
