# ProcureAI roadmap

All phases below are planned. The current step creates the folder structure and documentation only.

| Phase | Planned scope |
| --- | --- |
| V1 Procurement decision engine | Define demo procurement inputs and rules for making a procurement recommendation. |
| V2 Supplier validation | Validate fictional suppliers against demo eligibility rules. |
| V3 Currency normalization | Convert demo amounts into a common currency using synthetic exchange rates. |
| V4 Mock order backend | Build a Node.js backend for synthetic orders. |
| V5 SAPUI5/Fiori frontend | Create a user interface for the demo procurement workflow. |
| V6 MCP server | Expose selected demo backend capabilities through Model Context Protocol tools. |
| V7 AI procurement copilot | Add an AI agent that uses the demo tools to assist with procurement decisions. |

The SAP Integration Suite work already exists separately and will be documented in `integration-suite/` later. Use synthetic/demo data only throughout every phase; never add secrets, credentials, real SAP tenant URLs, company data, or personal tokens.
