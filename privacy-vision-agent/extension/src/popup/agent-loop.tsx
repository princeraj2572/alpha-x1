/**
 * Agent Loop Control Panel
 * UI for starting/monitoring multi-step automation
 */

import { useState } from 'react';

interface IterationResult {
  iteration: number;
  phase: string;
  action?: {
    type: string;
    target?: string;
    confidence?: number;
  };
  result?: {
    success: boolean;
    error?: string;
  };
}

export function AgentLoopPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [iterations, setIterations] = useState<IterationResult[]>([]);
  const [task, setTask] = useState('Complete the form on this page');
  const [maxIterations, setMaxIterations] = useState(10);
  const [status, setStatus] = useState<string | null>(null);

  const handleStartLoop = async () => {
    setIsRunning(true);
    setIterations([]);
    setStatus('Starting agent loop...');

    try {
      const response = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = response[0]?.id;

      if (!tabId) {
        setStatus('Error: No active tab found');
        setIsRunning(false);
        return;
      }

      chrome.tabs.sendMessage(
        tabId,
        {
          action: 'startAgentLoop',
          config: {
            task,
            maxIterations,
            timeoutMs: 60000,
          },
        },
        (response) => {
          if (response?.success) {
            setIterations(response.data.iterations);
            setStatus(`Completed ${response.data.iterations.length} iterations`);
          } else {
            setStatus(`Error: ${response?.error || 'Unknown error'}`);
          }
          setIsRunning(false);
        }
      );
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setIsRunning(false);
    }
  };

  return (
    <div style={{ padding: '12px', minWidth: '400px', fontFamily: 'sans-serif' }}>
      <h2>🤖 Agent Loop Control</h2>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Task:</label>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={isRunning}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            minHeight: '60px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '12px', display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Max Iterations:</label>
          <input
            type="number"
            value={maxIterations}
            onChange={(e) => setMaxIterations(parseInt(e.target.value))}
            disabled={isRunning}
            min={1}
            max={20}
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      <button
        onClick={handleStartLoop}
        disabled={isRunning}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: isRunning ? '#ccc' : '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isRunning ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
          fontSize: '14px',
        }}
      >
        {isRunning ? '⏳ Running...' : '▶ Start Agent Loop'}
      </button>

      {status && (
        <div
          style={{
            marginTop: '12px',
            padding: '8px',
            backgroundColor: '#f0f0f0',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}
        >
          {status}
        </div>
      )}

      {iterations.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Iterations ({iterations.length})</h3>
          <div
            style={{
              maxHeight: '300px',
              overflowY: 'auto',
              backgroundColor: '#f9f9f9',
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '8px',
            }}
          >
            {iterations.map((it, idx) => (
              <div
                key={idx}
                style={{
                  padding: '6px',
                  marginBottom: '4px',
                  backgroundColor: it.result?.success ? '#e8f5e9' : '#ffebee',
                  borderRadius: '3px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                }}
              >
                <strong>#{it.iteration}</strong> {it.phase}
                {it.action && ` → ${it.action.type}`}
                {it.result && (it.result.success ? ' ✓' : ` ✗ ${it.result.error}`)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
