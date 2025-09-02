import React, { useState } from "react";
import "./App.css";

function App() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState("");

  const ask = async () => {
    setLoading(true);
    setAnswer("");
    setSources([]);
    setMeta("");

    const start = Date.now();
    try {
      const res = await fetch("http://localhost:3000/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      const duration = data.duration || Date.now() - start;

      setAnswer(data.answer);
      setSources(data.contexts || []);
      setMeta(`Answered in ${duration} ms`);
    } catch (err) {
      setAnswer("Error fetching answer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <h2>Mini RAG (Gemini + Pinecone + Cohere)</h2>
      <textarea
        rows="3"
        cols="60"
        placeholder="Ask a question..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <br />
      <button onClick={ask} disabled={loading || !query.trim()}>
        {loading ? "Thinking..." : "Ask"}
      </button>

      {answer && (
        <div className="answer-box">
          <h3>Answer</h3>
          <p>{answer}</p>
          <p className="meta">{meta}</p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="sources-box">
          <h3>Sources</h3>
          {sources.map((s, i) => (
            <details key={i}>
              <summary>[{i + 1}]</summary>
              <p>{s}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
