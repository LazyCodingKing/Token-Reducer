/**
 * Token Reducer - SillyTavern Extension
 * Comprehensive token reduction with all features toggleable
 */

import { eventSource, event_types, saveChatConditional, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from "../../../../script.js";
import { getContext } from "../../../extensions.js";
import { loadSettings, settings, saveSettings, notify } from "./src/settings.js";
import { loadSlashCommands } from "./src/commands.js";
import { onMessageRendered, addMessageButtons, resetMessageButtons, applyCollapseStates } from "./src/messages.js";
import { updateTokenDisplay } from "./src/token-tracker.js";
import { loadMemoryData, injectMemoriesIntoContext, loadTimelineData, getTimelineForInjection } from "./src/memory-manager.js";

export const extension_name = 'SillyTavern-TokenReducer';
export const extension_path = `scripts/extensions/third-party/${extension_name}`;

const TIMELINE_INJECT_KEY = 'tr_timeline_injection';

let STVersion;
let lastSwipeId = null;
let lastMessageId = null;

/**
 * Check SillyTavern version compatibility
 */
function checkVersion(version_string) {
    const ver = version_string.pkgVersion.split('.').map(x => Number(x));
    // Requires 1.13.0 or higher
    if (ver[0] < 1) return false;
    if (ver[0] === 1 && ver[1] < 13) return false;
    return true;
}

/**
 * Handle generation started - inject memories if smart retrieval enabled
 */
async function onGenerationStarted() {
    if (!settings.enable_smart_retrieval) return;
    if (!settings.retrieval_on_send) return;

    try {
        await injectMemoriesIntoContext();
    } catch (err) {
        console.error('Token Reducer: Error injecting memories:', err);
    }
}

/**
 * Update timeline injection prompt
 * Uses setExtensionPrompt to inject timeline at the configured depth
 */
export function updateTimelineInjection() {
    // Check if settings loaded
    if (!settings) {
        console.warn('Token Reducer: Settings not loaded yet, skipping timeline injection');
        return;
    }

    // Clear injection if disabled
    if (!settings.enable_injection) {
        setExtensionPrompt(TIMELINE_INJECT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }

    // Get the timeline content
    const timeline = getTimelineForInjection();

    // If no timeline, don't inject
    if (!timeline) {
        setExtensionPrompt(TIMELINE_INJECT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }

    // Process the template with macros
    let prompt = settings.injection_template || '{{timeline}}';
    prompt = prompt.replace(/\{\{timeline\}\}/g, timeline);
    prompt = prompt.replace(/\{\{timelineResponses\}\}/g, ''); // Future: implement timeline fill responses

    // Trim empty sections
    prompt = prompt.replace(/\[.*?\]\s*\n+\s*\n/g, ''); // Remove empty sections
    prompt = prompt.trim();

    if (!prompt) {
        setExtensionPrompt(TIMELINE_INJECT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }

    const depth = parseInt(settings.injection_depth) || 0;
    const role = parseInt(settings.injection_role) || extension_prompt_roles.SYSTEM;

    setExtensionPrompt(
        TIMELINE_INJECT_KEY,
        prompt,
        extension_prompt_types.IN_CHAT,
        depth,
        false, // scan for WI
        role
    );

    console.log(`Token Reducer: Timeline injection updated: depth=${depth}, role=${role}, length=${prompt.length}`);
}

/**
 * Handle character message rendered - check token threshold AFTER AI responds
 * This prevents race conditions where summarization runs during AI generation
 */
async function onCharacterMessageRendered(mesId) {
    // First handle the message rendering UI
    onMessageRendered(mesId, 'character');

    const context = getContext();
    const chat = context.chat;
    const currentMessageIndex = parseInt(mesId);

    // Handle Swipe Re-summarization
    if (lastSwipeId === currentMessageIndex) {
        if (settings.enable_message_summary && settings.auto_summarize_on_swipe) {
            lastSwipeId = null;
            console.log('Token Reducer: Swipe detected, re-summarizing:', mesId);
            try {
                const { summarizeMessage } = await import('./src/summarizer.js');
                await summarizeMessage(mesId);
                onMessageRendered(mesId);
            } catch (err) {
                console.error('Token Reducer: Failed to load summarizer on swipe:', err);
            }
            return; // Exit after swipe processing
        }
        lastSwipeId = null;
    }

    // Handle Continue Re-summarization
    if (lastMessageId === currentMessageIndex && settings.enable_message_summary && settings.auto_summarize_on_continue) {
        if (chat[mesId].extra?.tr_summary) {
            console.log('Token Reducer: Continue detected, re-summarizing:', mesId);
            try {
                const { summarizeMessage } = await import('./src/summarizer.js');
                await summarizeMessage(mesId);
                onMessageRendered(mesId);
            } catch (err) {
                console.error('Token Reducer: Failed to load summarizer on continue:', err);
            }
            return; // Exit after continue processing
        }
    }

    lastMessageId = currentMessageIndex;

    // Auto-Scene Creation (Every N messages)
    if (settings.enable_scene_mode && settings.auto_scene_interval > 0) {
        try {
            const { findLastSceneEnd, summarizeScene } = await import('./src/summarizer.js');
            const lastEnd = findLastSceneEnd(currentMessageIndex);

            // Calculate messages since last scene end (excluding system messages ideally, but index diff is a good proxy for now)
            const count = currentMessageIndex - lastEnd;

            if (count >= settings.auto_scene_interval) {
                console.log(`Token Reducer: Auto-scene interval reached (${count} messages). Creating chapter...`);
                // Summarize from lastEnd + 1 to current
                await summarizeScene(lastEnd + 1, currentMessageIndex);
            }
        } catch (err) {
            console.error('Token Reducer: Error in auto-scene creation:', err);
        }
    }

    // Auto-summarize old messages if enabled
    if (settings.enable_message_summary && settings.auto_summarize) {
        try {
            const delay = settings.summary_delay_messages || 5;
            const oldestToSummarize = currentMessageIndex - delay;

            // Find messages that need summarizing (older than delay)
            for (let i = 0; i < oldestToSummarize && i < chat.length; i++) {
                // Skip if already summarized
                if (chat[i].extra?.tr_summary) continue;

                // Skip system messages
                if (chat[i].is_system) continue;

                // Skip user messages (summarize only AI) unless enabled
                if (chat[i].is_user && !settings.auto_summarize_user) continue;

                // Summarize this message
                console.log(`Token Reducer: Auto-summarizing message ${i} (${currentMessageIndex - i} messages old)`);
                try {
                    const { summarizeMessage } = await import('./src/summarizer.js');
                    await summarizeMessage(i);
                    // Update UI for the summarized message
                    onMessageRendered(i);
                } catch (err) {
                    console.error(`Token Reducer: Failed to summarize message ${i}:`, err);
                }
            }
        } catch (err) {
            console.error('Token Reducer: Error in auto-summarize:', err);
        }
    }

    // Always update display
    updateTokenDisplay();
}

/**
 * Handle chat change - load memory data for new chat
 */
async function onChatChanged(chatId) {
    if (!chatId) return;

    try {
        loadMemoryData();
        loadTimelineData(); // Load chapter timeline data
        resetMessageButtons();
        applyCollapseStates(); // Apply collapse to summarized messages
        updateTokenDisplay();
        updateTimelineInjection(); // Update timeline injection for new chat
    } catch (err) {
        console.error('Token Reducer: Error on chat change:', err);
    }
}

/**
 * Initialize the extension
 */
jQuery(async () => {
    try {
        const res = await fetch('/version');
        STVersion = await res.json();

        if (!checkVersion(STVersion)) {
            notify("error", "SillyTavern version 1.13.0 or higher required!", "Token Reducer");
            throw new Error("Token Reducer: Incompatible SillyTavern version");
        }

        // Register event handlers
        eventSource.on(event_types.APP_READY, async () => {
            console.log('Token Reducer: Initializing...');
            await loadSettings();
            loadSlashCommands();
            updateTokenDisplay();
            console.log('Token Reducer: Ready!');
        });

        eventSource.on(event_types.USER_MESSAGE_RENDERED, (mesId) => onMessageRendered(mesId, 'user'));
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
        eventSource.on(event_types.MORE_MESSAGES_LOADED, resetMessageButtons);

        // Edit Handler
        eventSource.on(event_types.MESSAGE_EDITED, async (mesId) => {
            if (!settings.enable_message_summary || !settings.auto_summarize_on_edit) return;
            const context = getContext();
            const message = context.chat[mesId];
            if (message?.extra?.tr_summary) {
                console.log('Token Reducer: Message edited, re-summarizing:', mesId);
                try {
                    const { summarizeMessage } = await import('./src/summarizer.js');
                    await summarizeMessage(mesId);
                    onMessageRendered(mesId);
                } catch (err) {
                    console.error('Token Reducer: Failed to load summarizer on edit:', err);
                }
            }
        });

        // Swipe Handler
        eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => {
            lastSwipeId = mesId;
        });

    } catch (err) {
        console.error('Token Reducer: Initialization failed:', err);
    }
});

