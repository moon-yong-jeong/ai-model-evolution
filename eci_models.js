// Training compute vs capability score, fitted from eci_benchmarks.csv. Used by scene 2.
// Source: Epoch AI, ECI Benchmarks + Notable/Frontier AI Models dataset (CC-BY).
// flopEst = true means the compute value is an estimate, worked out from C = 6*N*D for open models. 
// The rest are Epoch's published figures.

const ECI_DATA = [
  { "model": "Gemma 2B", "eci": 101.2, "flop": 2.4e+22, "flopEst": true, "org": "Google", "date": "2024-02-21" },
  { "model": "LLaMA-7B", "eci": 103.3, "flop": 4.2e+22, "flopEst": true, "org": "Meta", "date": "2023-02-24" },
  { "model": "INTELLECT-1", "eci": 107.7, "flop": 6e+22, "flopEst": true, "org": "Other", "date": "2024-11-29" },
  { "model": "LLaMA-13B", "eci": 107.0, "flop": 7.8e+22, "flopEst": true, "org": "Meta", "date": "2023-02-24" },
  { "model": "Llama 2-7B", "eci": 105.4, "flop": 8.4e+22, "flopEst": true, "org": "Meta", "date": "2023-07-18" },
  { "model": "Llama 2-13B", "eci": 111.8, "flop": 1.6e+23, "flopEst": true, "org": "Meta", "date": "2023-07-18" },
  { "model": "Gemma 7B", "eci": 115.3, "flop": 2.5e+23, "flopEst": true, "org": "Google", "date": "2024-02-21" },
  { "model": "LLaMA-33B", "eci": 112.9, "flop": 2.8e+23, "flopEst": true, "org": "Meta", "date": "2023-02-24" },
  { "model": "Llama 2-34B", "eci": 111.3, "flop": 4.1e+23, "flopEst": true, "org": "Meta", "date": "2023-07-18" },
  { "model": "Gemma 2 9B", "eci": 121.8, "flop": 4.3e+23, "flopEst": true, "org": "Google", "date": "2024-06-27" },
  { "model": "LLaMA-65B", "eci": 115.2, "flop": 5.5e+23, "flopEst": true, "org": "Meta", "date": "2023-02-24" },
  { "model": "Llama 2-70B", "eci": 118.1, "flop": 8.4e+23, "flopEst": true, "org": "Meta", "date": "2023-07-18" },
  { "model": "Gemma 2 27B", "eci": 123.6, "flop": 2.1e+24, "flopEst": true, "org": "Google", "date": "2024-06-27" },
  { "model": "Gemma 3 27B", "eci": 132.3, "flop": 2.3e+24, "flopEst": true, "org": "Google", "date": "2025-03-12" },
  { "model": "Kimi K2 Thinking", "eci": 146.9, "flop": 4.2e+24, "flopEst": false, "org": "Moonshot", "date": "2025-11-06" },
  { "model": "Llama 3-70B", "eci": 125.3, "flop": 6.3e+24, "flopEst": true, "org": "Meta", "date": "2024-04-18" },
  { "model": "Claude 3.5 Sonnet", "eci": 130.0, "flop": 2.7e+25, "flopEst": false, "org": "Anthropic", "date": "2024-06-20" },
  { "model": "Grok-2 (Dec 2024)", "eci": 131.1, "flop": 2.96e+25, "flopEst": false, "org": "xAI", "date": "2024-08-13" },
  { "model": "Grok 3", "eci": 140.0, "flop": 3.5e+26, "flopEst": false, "org": "xAI", "date": "2025-02-17" },
  { "model": "Grok 4", "eci": 150.0, "flop": 5e+26, "flopEst": false, "org": "xAI", "date": "2025-07-09" }
];
