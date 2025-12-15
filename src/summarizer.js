/**
 * AI Summarization Functions
 */

import { getContext, extension_settings } from "../../../../extensions.js";
import { ConnectionManagerRequestService } from "../../../../extensions/shared.js";
import { hideChatMessageRange } from "../../../../chats.js";
import { settings, notify } from "./settings.js";
import { storeMemory } from "./memory-manager.js";
import { collapseAfterSummarize } from "./messages.js";

let lastGenTimestamp = 0;

/**
 * Get delay between API calls based on rate limit
 */
function getDelayMs() {
    return Math.max(500, 60000 / Number(settings.rate_limit || 60));
}

/**
 * Wait for rate limit if needed
 */
async function waitForRateLimit() {
    const delay = getDelayMs() - (Date.now() - lastGenTimestamp);
    if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    lastGenTimestamp = Date.now();
}

/**
 * Get the max tokens setting for the current connection profile
 * @param {string} profileId - The connection profile ID
 * @returns {number} Max tokens value
 */
function getMaxTokensForProfile(profileId) {
    const profiles = extension_settings?.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.id === profileId);

    // Get max tokens from profile settings or use a reasonable default
    if (profile?.['max-tokens']) {
        return Number(profile['max-tokens']);
    }

    // Default to 1024 for summarization (we want concise summaries)
    return 1024;
}

/**
 * Generate text using the AI via ConnectionManagerRequestService
 * Uses structured messages with system and user roles for proper summarization
 * @param {string} content - The message content to summarize
 * @param {string} systemPrompt - The summarization instructions
 * @returns {Promise<string>} Generated text
 */
async function generateText(content, systemPrompt) {
    const context = getContext();
    let result = '';

    // Check if we have an active chat
    if (!context.chat || context.chat.length === 0) {
        console.warn('Token Reducer: No active chat for generation');
        notify("warning", 'Please open a chat first', 'Token Reducer');
        return '';
    }

    // Get the profile ID from settings
    const profileId = settings.summarization_profile;
    if (!profileId) {
        console.error('Token Reducer: No summarization profile configured');
        notify("error", 'Please select a Summarization Profile in Token Reducer settings', 'Token Reducer');
        return '';
    }

    try {
        await waitForRateLimit();
        context.deactivateSendButtons();

        // Build messages array (like timeline-memory does)
        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: content });

        // Get max tokens for the profile
        const maxTokens = getMaxTokensForProfile(profileId);

        console.log('Token Reducer: Sending request to profile:', profileId);
        console.log('Token Reducer: Messages:', messages);

        // Use ConnectionManagerRequestService to send the request
        const response = await ConnectionManagerRequestService.sendRequest(
            profileId,
            messages,
            maxTokens,
            {
                includePreset: true,
                includeInstruct: true,
                stream: false
            }
        );

        // Extract content from response
        result = response?.content || response || '';

        // Parse out any reasoning if present
        const parsed = context.parseReasoningFromString?.(result);
        if (parsed) {
            result = parsed.content;
        }

        console.log('Token Reducer: Summary result:', result.substring(0, 100) + '...');
    } catch (err) {
        console.error('Token Reducer: Generation error:', err);
        notify("error", 'Generation failed: ' + err.message, 'Token Reducer');
    } finally {
        context.activateSendButtons();
    }

    return result.trim();
}

/**
 * Auto-hide summarized messages from AI context
 * Hides all messages that have been summarized, except the last N (keep_recent_count)
 * This mirrors MemoryBooks' batch-hide approach
 * @param {Object} context - SillyTavern context
 */
async function autoHideSummarizedMessages(context) {
    const chat = context.chat;
    const unhiddenCount = settings.keep_recent_count || 0;

    // Find all messages with summaries (have tr_summary in extra)
    const summarizedIndices = [];
    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];
        if (message?.extra?.tr_summary && !message.is_system) {
            summarizedIndices.push(i);
        }
    }

    if (summarizedIndices.length === 0) {
        console.log('Token Reducer: No summarized messages to hide');
        return;
    }

    // Calculate how many to hide: all except the last unhiddenCount
    const hideCount = summarizedIndices.length - unhiddenCount;
    if (hideCount <= 0) {
        console.log(`Token Reducer: Not enough summarized messages to hide (${summarizedIndices.length} summarized, keeping ${unhiddenCount})`);
        return;
    }

    // Get the indices to hide (the oldest summarized messages)
    const indicesToHide = summarizedIndices.slice(0, hideCount);

    console.log(`Token Reducer: Hiding ${indicesToHide.length} summarized messages (keeping last ${unhiddenCount})`);

    // Hide each message using SillyTavern's hideChatMessageRange
    for (const idx of indicesToHide) {
        const message = chat[idx];
        // Only hide if not already hidden
        if (!message.is_system) {
            await hideChatMessageRange(idx, idx, false);
            console.log(`Token Reducer: Hidden message ${idx} from AI context`);
        }
    }
}

/**
 * Summarize a single message
 * @param {number} mesId - Message ID to summarize
 * @returns {Promise<string>} The generated summary
 */
export async function summarizeMessage(mesId) {
    const context = getContext();
    const chat = context.chat;

    if (mesId < 0 || mesId >= chat.length) {
        throw new Error('Invalid message ID');
    }

    const message = chat[mesId];
    const content = `${message.name}: ${message.mes}`;

    // Separate the system prompt (instructions) from the content (message to summarize)
    const systemPrompt = settings.summary_prompt.replace('{{content}}', '').trim();

    notify("info", `Summarizing message ${mesId}...`, 'Token Reducer');
    const summary = await generateText(content, systemPrompt);

    if (summary) {
        // Store summary in message metadata
        if (!message.extra) message.extra = {};
        message.extra.tr_summary = summary;
        message.extra.tr_summarized_at = Date.now();

        await context.saveChat();

        // Also store to lorebook if enabled
        await storeMemory(summary, null, {
            type: 'message',
            mesId: mesId,
            title: `Message ${mesId} Summary`
        });

        // Collapse the message if auto-collapse is enabled
        collapseAfterSummarize(mesId);

        // Auto-hide summarized messages from AI context if enabled
        if (settings.auto_hide_summarized) {
            await autoHideSummarizedMessages(context);
        }

        notify("success", `Message ${mesId} summarized`, 'Token Reducer');
    }

    return summary;
}

/**
 * Summarize multiple messages in a range (for scenes/chapters)
 * @param {number} startId - First message ID
 * @param {number} endId - Last message ID
 * @returns {Promise<string>} The generated scene summary
 */
export async function summarizeScene(startId, endId) {
    const context = getContext();
    const chat = context.chat;

    if (startId < 0 || endId >= chat.length || startId > endId) {
        throw new Error('Invalid message range');
    }

    // Get all visible messages in range
    const messages = [];
    for (let i = startId; i <= endId; i++) {
        const msg = chat[i];
        if (!msg.is_system) {
            messages.push(`${msg.name}: ${msg.mes}`);
        }
    }

    if (messages.length === 0) {
        throw new Error('No visible messages in range');
    }

    const content = messages.join('\n\n');

    // Check if content is too large and needs chunking
    const maxTokens = context.maxContext - 500; // Leave room for prompt
    const tokenCount = await context.getTokenCountAsync(content);

    let finalSummary;

    if (tokenCount > maxTokens) {
        // Chunk the content and summarize each chunk
        notify("info", 'Scene is large, summarizing in chunks...', 'Token Reducer');
        finalSummary = await summarizeInChunks(messages, maxTokens);
    } else {
        const systemPrompt = settings.scene_summary_prompt.replace('{{content}}', '').trim();
        notify("info", `Summarizing scene (${messages.length} messages)...`, 'Token Reducer');
        finalSummary = await generateText(content, systemPrompt);
    }

    if (finalSummary) {
        // Mark the end message as scene end
        const endMessage = chat[endId];
        if (!endMessage.extra) endMessage.extra = {};
        endMessage.extra.tr_scene_end = true;
        endMessage.extra.tr_scene_summary = finalSummary;
        endMessage.extra.tr_scene_start = startId;
        endMessage.extra.tr_summarized_at = Date.now();

        // Optionally hide summarized messages
        if (settings.hide_summarized_scenes) {
            for (let i = startId; i < endId; i++) {
                chat[i].is_system = true;
                $(`.mes[mesid="${i}"]`).attr('is_system', 'true');
            }
        }

        await context.saveChat();

        // Also store to lorebook if enabled
        await storeMemory(finalSummary, null, {
            type: 'scene',
            mesId: endId,
            title: `Scene Summary (Messages ${startId}-${endId})`
        });

        notify("success", `Scene summarized (${messages.length} messages)`, 'Token Reducer');
    }

    return finalSummary;
}

/**
 * Summarize content in chunks for very long scenes
 */
async function summarizeInChunks(messages, maxTokens) {
    const context = getContext();
    const getTokenCount = context.getTokenCountAsync;

    // Split messages into chunks
    const chunks = [];
    let currentChunk = [];
    let currentTokens = 0;

    for (const msg of messages) {
        const msgTokens = await getTokenCount(msg);

        if (currentTokens + msgTokens > maxTokens && currentChunk.length > 0) {
            chunks.push(currentChunk.join('\n\n'));
            currentChunk = [msg];
            currentTokens = msgTokens;
        } else {
            currentChunk.push(msg);
            currentTokens += msgTokens;
        }
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'));
    }

    // Summarize each chunk
    const chunkSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
        notify("info", `Summarizing chunk ${i + 1}/${chunks.length}...`, 'Token Reducer');
        const chunkSystemPrompt = settings.scene_summary_prompt.replace('{{content}}', '').trim();
        const summary = await generateText(chunks[i], chunkSystemPrompt);
        if (summary) {
            chunkSummaries.push(summary);
        }
    }

    // If multiple chunks, summarize the summaries
    if (chunkSummaries.length > 1) {
        notify("info", 'Combining chunk summaries...', 'Token Reducer');
        const combinedContent = chunkSummaries.join('\n\n---\n\n');
        const combineSystemPrompt = settings.scene_summary_prompt.replace('{{content}}', '').trim();
        return await generateText(combinedContent, combineSystemPrompt);
    }

    return chunkSummaries[0] || '';
}

/**
 * Generate keywords for a piece of content
 * @param {string} content - Content to extract keywords from
 * @returns {Promise<string[]>} Array of keywords
 */
export async function generateKeywords(content) {
    const keywordSystemPrompt = settings.keywords_prompt.replace('{{content}}', '').trim();

    notify("info", 'Generating keywords...', 'Token Reducer');
    let result = await generateText(content, keywordSystemPrompt, ['\n']);

    // Parse comma-separated keywords
    const keywords = result
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .slice(0, 5);

    return keywords;
}

/**
 * Get the summary for a message (if it exists)
 */
export function getMessageSummary(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    return message?.extra?.tr_summary || null;
}

/**
 * Get the scene summary for a message (if it's a scene end)
 */
export function getSceneSummary(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    return message?.extra?.tr_scene_summary || null;
}

/**
 * Check if a message has been summarized
 */
export function isMessageSummarized(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    return !!message?.extra?.tr_summary;
}

/**
 * Check if a message is a scene end
 */
export function isSceneEnd(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    return !!message?.extra?.tr_scene_end;
}

/**
 * Find the last scene end before a given message
 */
export function findLastSceneEnd(beforeMesId) {
    const context = getContext();
    const chat = context.chat;

    for (let i = beforeMesId - 1; i >= 0; i--) {
        if (chat[i]?.extra?.tr_scene_end) {
            return i;
        }
    }

    return -1; // No previous scene end, use chat start
}

/**
 * Summarize all unsummarized messages in the chat
 */
export async function summarizeAllMessages() {
    const context = getContext();
    const chat = context.chat;

    let summarized = 0;
    const toSummarize = [];

    // Find messages that need summarization
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg.is_system && !msg.extra?.tr_summary) {
            toSummarize.push(i);
        }
    }

    if (toSummarize.length === 0) {
        notify("info", 'All messages already summarized', 'Token Reducer');
        return 0;
    }

    notify("info", `Summarizing ${toSummarize.length} messages...`, 'Token Reducer');

    for (const mesId of toSummarize) {
        try {
            await summarizeMessage(mesId);
            summarized++;
        } catch (err) {
            console.error(`Token Reducer: Failed to summarize message ${mesId}:`, err);
        }
    }

    notify("success", `Summarized ${summarized} messages`, 'Token Reducer');
    return summarized;
}

/**
 * Clear all summaries from the chat
 */
export async function clearAllSummaries() {
    const context = getContext();
    const chat = context.chat;

    let cleared = 0;

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.extra) {
            let modified = false;

            if (msg.extra.tr_summary) {
                delete msg.extra.tr_summary;
                if (msg.extra.tr_summarized_at) delete msg.extra.tr_summarized_at;
                modified = true;
                cleared++;
            }
            if (msg.extra.tr_scene_summary) {
                delete msg.extra.tr_scene_end;
                delete msg.extra.tr_scene_summary;
                delete msg.extra.tr_scene_start;
                if (msg.extra.tr_summarized_at) delete msg.extra.tr_summarized_at;
                modified = true;
                cleared++;
            }

            // Restore visibility if it was hidden by us
            if (modified && msg.is_system && msg.extra.tr_summary) {
                // If it was hidden because of summary, unhide it?
                // Actually, logic for unhiding is complex because user might have hidden manually.
                // For now just clearing the meta.
            }
        }
    }

    if (cleared > 0) {
        await context.saveChat();
        notify("success", `Cleared ${cleared} summaries`, 'Token Reducer');
    } else {
        notify("info", 'No summaries to clear', 'Token Reducer');
    }

    return cleared;
}

/**
 * Automatically fill missing chapters based on interval
 * @param {number} interval - Number of messages per chapter
 */
export async function autoFillChapters(interval) {
    if (!interval || interval < 5) throw new Error('Interval must be at least 5 messages');

    const context = getContext();
    const chat = context.chat;
    let created = 0;

    notify("info", `Auto-filling chapters (interval: ${interval})...`, 'Token Reducer');

    let processedCount = 0;
    let lastSceneEnd = -1;

    // Find the last existing scene end to start from
    for (let i = 0; i < chat.length; i++) {
        if (chat[i]?.extra?.tr_scene_end) {
            lastSceneEnd = i;
        }
    }

    // If no scenes exist, start from beginning. If scenes exist, start from last scene + 1
    let startScan = lastSceneEnd + 1;

    // We need to look for blocks of 'interval' size
    // But we iterate message by message
    let currentBlockStart = startScan;

    while (currentBlockStart < chat.length) {
        // Calculate potential end of this block
        let potentialEnd = currentBlockStart + interval - 1;

        // If we are near the end of chat, check if we have enough messages
        if (potentialEnd >= chat.length) {
            break; // Not enough messages for a full chapter
        }

        // Check if there's an existing scene end within this block (shouldn't be, if we logic right)
        // But let's be safe.
        let hitExisting = false;
        for (let j = currentBlockStart; j <= potentialEnd; j++) {
            if (chat[j]?.extra?.tr_scene_end) {
                currentBlockStart = j + 1;
                hitExisting = true;
                break;
            }
        }

        if (hitExisting) continue;

        // Found a block! Summarize it.
        try {
            await summarizeScene(currentBlockStart, potentialEnd);
            created++;
            currentBlockStart = potentialEnd + 1;
        } catch (err) {
            console.error(`Token Reducer: Failed to auto-fill chapter at ${currentBlockStart}-${potentialEnd}:`, err);
            // Skip this block to avoid infinite loop if error persists
            currentBlockStart++;
        }
    }

    if (created > 0) {
        notify("success", `Created ${created} missing chapters`, 'Token Reducer');
    } else {
        notify("info", 'No missing chapters found to fill', 'Token Reducer');
    }

    return created;
}
