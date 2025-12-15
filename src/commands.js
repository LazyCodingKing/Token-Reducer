/**
 * Slash Commands for Token Reducer
 */

import { getContext } from "../../../../extensions.js";
import { settings } from "./settings.js";
import { summarizeMessage, summarizeScene, summarizeAllMessages, clearAllSummaries, findLastSceneEnd, autoFillChapters } from "./summarizer.js";
import { getTotalSavings, updateTokenDisplay } from "./token-tracker.js";
import { retrieveRelevantMemories, getTimeline, exportMemories, analyzeAndShowArcs } from "./memory-manager.js";

/**
 * Register slash commands
 */
export function loadSlashCommands() {
    const context = getContext();
    const SlashCommandParser = context.SlashCommandParser;
    const SlashCommand = context.SlashCommand;
    const ARGUMENT_TYPE = context.ARGUMENT_TYPE;
    const SlashCommandArgument = context.SlashCommandArgument;

    if (!SlashCommandParser) {
        console.warn('Token Reducer: SlashCommandParser not available');
        return;
    }

    // /tr-summarize - Summarize a specific message
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-summarize',
        callback: async (args, value) => {
            const mesId = parseInt(value || args.id);
            if (isNaN(mesId)) {
                return 'Error: Please provide a valid message ID';
            }

            try {
                const summary = await summarizeMessage(mesId);
                updateTokenDisplay();
                return summary || 'Failed to generate summary';
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['trs'],
        namedArgumentList: [
            SlashCommandArgument.fromProps({
                name: 'id',
                description: 'Message ID to summarize',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: false
            })
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Message ID to summarize',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: false
            })
        ],
        helpString: 'Summarize a specific message by ID. Example: /tr-summarize 10'
    }));

    // /tr-analyze - Suggest chapter breaks
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-analyze',
        callback: async () => {
            try {
                const result = await analyzeAndShowArcs();
                return result;
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['tra'],
        helpString: 'Analyze recent conversation for potential chapter breaks (Active Arc Analysis)'
    }));

    // /tr-scene-end - End scene at a message
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-scene-end',
        callback: async (args, value) => {
            const mesId = parseInt(value || args.id);
            if (isNaN(mesId)) {
                return 'Error: Please provide a valid message ID';
            }

            try {
                const lastEnd = findLastSceneEnd(mesId);
                const startId = lastEnd + 1;
                const summary = await summarizeScene(startId, mesId);
                updateTokenDisplay();
                return summary || 'Failed to generate scene summary';
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['trse'],
        namedArgumentList: [
            SlashCommandArgument.fromProps({
                name: 'id',
                description: 'Message ID to end scene at',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: false
            })
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Message ID to end scene at',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: false
            })
        ],
        helpString: 'End scene at a specific message, summarizing from the last scene end. Example: /tr-scene-end 25'
    }));

    // /tr-autofill - Retroactively fill missing chapters
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-autofill',
        callback: async (args, value) => {
            const interval = parseInt(value || args.interval);
            if (isNaN(interval) || interval < 5) {
                return 'Error: Please provide a valid interval (minimum 5 messages). Example: /tr-autofill 20';
            }

            try {
                const count = await autoFillChapters(interval);
                updateTokenDisplay();
                return `Auto-fill complete: Created ${count} chapters.`;
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['traf'],
        namedArgumentList: [
            SlashCommandArgument.fromProps({
                name: 'interval',
                description: 'Number of messages per chapter (min 5)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true
            })
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Number of messages per chapter (min 5)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true
            })
        ],
        helpString: 'Automatically fill missing chapters with a set interval. Example: /tr-autofill 20'
    }));

    // /tr-status - Show token savings stats
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-status',
        callback: async () => {
            const savings = await getTotalSavings();

            const status = [
                `📊 Token Reducer Status`,
                `─────────────────────`,
                `Summarized Messages: ${savings.summarizedCount}`,
                `Original Tokens: ${savings.original.toLocaleString()}`,
                `With Summaries: ${savings.current.toLocaleString()}`,
                `Tokens Saved: ${savings.saved.toLocaleString()} (${savings.savedPercent}%)`,
                `─────────────────────`,
                `Auto-summarize: ${settings.auto_summarize ? 'ON' : 'OFF'}`,
                `Replace with summary: ${settings.replace_with_summary ? 'ON' : 'OFF'}`
            ].join('\n');

            return status;
        },
        aliases: ['trstatus'],
        helpString: 'Show current token savings statistics'
    }));

    // /tr-retrieve - Manually retrieve relevant context
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-retrieve',
        callback: async (args, value) => {
            try {
                const memories = await retrieveRelevantMemories(value);

                if (memories.length === 0) {
                    return 'No relevant memories found';
                }

                const result = [
                    `📚 Retrieved ${memories.length} memories:`,
                    ...memories.map((m, i) => `${i + 1}. ${m.summary.substring(0, 100)}...`)
                ].join('\n');

                return result;
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['trr'],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Query text (optional, defaults to last message)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false
            })
        ],
        helpString: 'Retrieve memories relevant to the given query or last message'
    }));

    // /tr-all - Summarize all messages
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-all',
        callback: async () => {
            try {
                const count = await summarizeAllMessages();
                updateTokenDisplay();
                return `Summarized ${count} messages`;
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['trall'],
        helpString: 'Summarize all unsummarized messages in the chat'
    }));

    // /tr-clear - Clear all summaries
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-clear',
        callback: async () => {
            try {
                const count = await clearAllSummaries();
                updateTokenDisplay();
                return `Cleared ${count} summaries`;
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['trclear'],
        helpString: 'Clear all summaries from the current chat'
    }));

    // /tr-timeline - Show the timeline of scene summaries
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-timeline',
        callback: async () => {
            const timeline = getTimeline();

            if (timeline.length === 0) {
                return 'No scenes recorded yet. Use /tr-scene-end to create scene summaries.';
            }

            const result = [
                `📜 Timeline (${timeline.length} scenes):`,
                '─────────────────────',
                ...timeline.map((summary, i) => `**Scene ${i + 1}:** ${summary}`)
            ].join('\n\n');

            return result;
        },
        aliases: ['trtl'],
        helpString: 'Show the timeline of scene summaries'
    }));

    // /tr-export - Export memories to JSON
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'tr-export',
        callback: async () => {
            try {
                const json = exportMemories();

                // Create download
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `token-reducer-memories-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);

                return 'Memories exported successfully';
            } catch (err) {
                return `Error: ${err.message}`;
            }
        },
        aliases: ['trexport'],
        helpString: 'Export all memories to a JSON file'
    }));

    console.log('Token Reducer: Slash commands registered');
}
