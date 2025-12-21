Work in progress, it might not work well

# SillyTavern Token Reducer
MADE USING GOOGLE ANTIGRAVITY BASED ON POPULAR MEMORY EXTENSIONS FOR PERSONAL USE

A comprehensive token reduction extension for SillyTavern 1.13+ that helps manage context window usage during roleplay.

## Features

All features are **fully toggleable** in the settings panel:

### 🔄 Per-Message Summarization
- Summarize individual messages to reduce token count
- Auto-summarize after configurable message count
- Replace full messages with summaries in context

### 📖 Scene/Chapter Summarization
- Mark scene endings for bulk summarization
- AI-powered scene break detection
- Hide messages after scene is summarized

### 💾 Memory Storage
- Store to chat metadata, lorebook, or both
- Probability-based memory activation
- Pop-up memories with low activation chance

### 📊 Token Threshold Management
- Real-time token usage display
- Auto-summarize when threshold exceeded
- Aggressive mode for faster reduction

### 🔍 Smart Context Retrieval
- AI queries only relevant memories
- Auto-retrieve before each message
- Configurable max memories to inject

### ⚙️ Customizable Settings
- Custom summarization prompts
- Separate connection profile for summarization
- Rate limiting for API calls

## Installation

### Method 1: Via SillyTavern UI
1. Open SillyTavern
2. Go to Extensions → Install Extension
3. Paste: `https://github.com/your-username/SillyTavern-TokenReducer`
4. Click Install

### Method 2: Manual
```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/your-username/SillyTavern-TokenReducer
```

## Usage

### Settings Panel
Open Extensions → Token Reducer to access all settings.

### Message Buttons
- **Compress icon**: Summarize single message
- **Flag icon**: End scene at this message

### Slash Commands
| Command | Alias | Description |
|---------|-------|-------------|
| `/tr-summarize [id]` | `/trs` | Summarize a specific message |
| `/tr-scene-end [id]` | `/trse` | End scene and summarize |
| `/tr-status` | `/trstatus` | Show token usage stats |
| `/tr-retrieve [query]` | `/trr` | Retrieve relevant memories |
| `/tr-all` | `/trall` | Summarize all messages |
| `/tr-clear` | `/trclear` | Clear all summaries |
| `/tr-timeline` | `/trtl` | Show scene timeline |
| `/tr-export` | `/trexport` | Export memories to JSON |

## Settings Reference

### Per-Message Summarization
| Setting | Default | Description |
|---------|---------|-------------|
| Enable Message Summary | OFF | Summarize individual messages |
| Auto-Summarize | OFF | Auto-summarize without action |
| Messages before auto-summary | 5 | Delay before auto-summarization |
| Replace with Summary | OFF | Replace full content in context |

### Token Threshold
| Setting | Default | Description |
|---------|---------|-------------|
| Enable Threshold | ON | Monitor token usage |
| Threshold % | 70% | When to trigger auto-summarization |
| Summarize Oldest First | ON | Start with oldest messages |
| Aggressive Mode | OFF | More aggressive reduction |

### Memory Storage
| Setting | Default | Description |
|---------|---------|-------------|
| Storage Mode | Metadata | Where to store memories |
| Lorebook Probability | 50% | Activation chance |
| Pop-up Memories | OFF | Low-probability constant memories |

## Requirements

- SillyTavern 1.13.0 or higher
- Any LLM API connection for summarization

## Credits

Inspired by:
- [timeline-memory](https://github.com/unkarelian/timeline-memory)
- [SillyTavern-ReMemory](https://github.com/InspectorCaracal/SillyTavern-ReMemory)
- [SillyTavern-MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)
- [st-qdrant-memory](https://github.com/HO-git/st-qdrant-memory)
- [SillyTavern-MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)

## License

AGPL-3.0
