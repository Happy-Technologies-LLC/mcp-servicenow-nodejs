# ServiceNow MCP Server - Documentation

Complete documentation for the ServiceNow MCP Server v2.0.

---

## 📚 Documentation Index

### Getting Started

- **[API Reference](API_REFERENCE.md)** - Complete reference for all MCP tools
- **[Setup Guide](SETUP_GUIDE.md)** - Installation and configuration
- **[Multi-Instance Configuration](MULTI_INSTANCE_CONFIGURATION.md)** - Connect to multiple ServiceNow instances

### Guides

- **[Instance Switching Guide](INSTANCE_SWITCHING_GUIDE.md)** - How to route requests between instances
- **[403 Troubleshooting](403_TROUBLESHOOTING.md)** - Fix permission errors

### Research & Technical Deep-Dives

The **[research/](research/)** folder contains technical research, breakthrough discoveries, and architectural analysis:

- **Flow Designer feasibility analysis**
- **Background script execution breakthroughs**
- **Workflow vs Flow Designer comparison**
- **Architecture evolution**
- **Change logs and testing recommendations**

---

## Quick Links

**Main Documentation:** [../README.md](../README.md)
**Source Code:** [../src/](../src/)
**Configuration:** [../config/](../config/)

---

## Documentation Organization

```
docs/
├── README.md                          # This file
├── API_REFERENCE.md                   # Complete API documentation
├── SETUP_GUIDE.md                     # Setup instructions
├── MULTI_INSTANCE_CONFIGURATION.md    # Multi-instance setup
├── INSTANCE_SWITCHING_GUIDE.md        # Instance routing guide
├── 403_TROUBLESHOOTING.md             # Permission troubleshooting
└── research/                          # Technical research & discoveries
    ├── FLOW_DESIGNER_MCP_FEASIBILITY.md
    ├── BACKGROUND_SCRIPT_EXECUTION.md
    ├── UI_API_BREAKTHROUGH.md
    ├── WORKFLOW_CREATION.md
    └── ... (more research docs)
```

---

## Contributing

When adding new documentation:

1. **Operational Docs** → Place in `docs/` root
2. **Research/Analysis** → Place in `docs/research/`
3. **Update this README** with links to new docs

---

## Support

For issues or questions:
- Check the troubleshooting guides
- Review research docs for technical details
- See main README.md for project overview