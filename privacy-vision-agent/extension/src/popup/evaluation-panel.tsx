/**
 * Evaluation Panel
 * UI for running and viewing evaluation metrics
 */

import React, { useState } from 'react';

interface MetricResult {
  category: string;
  status: 'PASS' | 'FAIL' | 'PENDING';
  metrics: Record<string, any>;
  details?: string;
}

export function EvaluationPanel() {
  const [results, setResults] = useState<MetricResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<number | null>(null);

  const handleRunEvaluation = async () => {
    setIsRunning(true);
    setResults([]);

    try {
      const response = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = response[0]?.id;

      if (!tabId) {
        console.error('No active tab');
        setIsRunning(false);
        return;
      }

      chrome.tabs.sendMessage(
        tabId,
        {
          action: 'runEvaluation',
        },
        (response) => {
          if (response?.success && response.data) {
            const metricsData = response.data.metrics || [];
            setResults(metricsData);
          }
          setIsRunning(false);
        }
      );
    } catch (error) {
      console.error('Evaluation error:', error);
      setIsRunning(false);
    }
  };

  return (
    <div style={{ padding: '12px', minWidth: '500px', fontFamily: 'sans-serif' }}>
      <h2>📊 Evaluation Metrics</h2>

      <button
        onClick={handleRunEvaluation}
        disabled={isRunning}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: isRunning ? '#ccc' : '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isRunning ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
          marginBottom: '16px',
        }}
      >
        {isRunning ? '⏳ Running Evaluation...' : '▶ Run Full Evaluation'}
      </button>

      {results.length > 0 && (
        <div>
          {/* Summary */}
          <div
            style={{
              backgroundColor: '#f5f5f5',
              padding: '12px',
              borderRadius: '4px',
              marginBottom: '12px',
            }}
          >
            <h3 style={{ fontSize: '14px', margin: '0 0 8px 0' }}>Summary</h3>
            <div style={{ fontSize: '12px' }}>
              <div>Total Metrics: {results.length}</div>
              <div>Passed: {results.filter((r) => r.status === 'PASS').length}</div>
              <div>Failed: {results.filter((r) => r.status === 'FAIL').length}</div>
            </div>
          </div>

          {/* Metrics List */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              marginBottom: '12px',
            }}
          >
            {results.map((result, idx) => (
              <div
                key={idx}
                onClick={() => setSelectedMetric(selectedMetric === idx ? null : idx)}
                style={{
                  padding: '10px',
                  backgroundColor: result.status === 'PASS' ? '#e8f5e9' : '#ffebee',
                  borderLeft: `4px solid ${result.status === 'PASS' ? '#4CAF50' : '#f44336'}`,
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                <strong>{result.category}</strong>
                <div style={{ color: '#666', fontSize: '11px' }}>
                  {result.status === 'PASS' ? '✓' : '✗'} {result.status}
                </div>
              </div>
            ))}
          </div>

          {/* Detail Panel */}
          {selectedMetric !== null && results[selectedMetric] && (
            <div
              style={{
                backgroundColor: 'white',
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '12px',
                fontSize: '11px',
                fontFamily: 'monospace',
                maxHeight: '300px',
                overflowY: 'auto',
              }}
            >
              <h4 style={{ margin: '0 0 8px 0' }}>{results[selectedMetric].category}</h4>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                {JSON.stringify(results[selectedMetric].metrics, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
