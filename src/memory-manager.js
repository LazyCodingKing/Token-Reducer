/**
 * Memory Storage and Retrieval
 */

import { getContext, extension_settings } from "../../../../extensions.js";
import { createWorldInfoEntry, createNewWorldInfo, METADATA_KEY, world_names, loadWorldInfo, saveWorldInfo, reloadEditor, updateWorldInfoList } from "../../../../world-info.js";
import { chat_metadata, saveMetadata, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from "../../../../../script.js";
import { settings, notify } from "./settings.js";
import { generateKeywords, summarizeScene } from "./summarizer.js"; // Import summarizeScene

const RETRIEVAL_INJECT_KEY = 'tr_retrieval_injection';



// In-memory cache of memories for current chat
let memoryCache = [];
let lastSceneEnd = -1;

// Chapter timeline data (stored in chat_metadata.tr_timeline)
let timelineData = [];


/**
 * Load memory data for current chat
 */
export function loadMemoryData() {
    const context = getContext();
    const chat = context.chat;

    memoryCache = [];
    lastSceneEnd = -1;

    // Scan chat for existing summaries
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];

        if (msg.extra?.tr_summary) {
            memoryCache.push({
                type: 'message',
                mesId: i,
                summary: msg.extra.tr_summary,
                timestamp: msg.extra.tr_summarized_at || Date.now()
            });
        }

        if (msg.extra?.tr_scene_end) {
            memoryCache.push({
                type: 'scene',
                mesId: i,
                startId: msg.extra.tr_scene_start,
                summary: msg.extra.tr_scene_summary,
                timestamp: msg.extra.tr_summarized_at || Date.now()
            });
            lastSceneEnd = i;
        }
    }

    console.log(`Token Reducer: Loaded ${memoryCache.length} memories`);
}

/**
 * Get all stored memories
 */
export function getMemories() {
    return [...memoryCache];
}

/**
 * Get the timeline (chronological list of summaries)
 */
export function getTimeline() {
    return memoryCache
        .filter(m => m.type === 'scene')
        .sort((a, b) => a.mesId - b.mesId)
        .map(m => m.summary);
}

// ============ CHAPTER TIMELINE MANAGEMENT ============

/**
 * Load timeline data from chat metadata
 */
export function loadTimelineData() {
    const context = getContext();
    if (context.chatMetadata?.tr_timeline) {
        timelineData = context.chatMetadata.tr_timeline;
    } else {
        timelineData = [];
    }
    console.log(`Token Reducer: Loaded ${timelineData.length} chapters from timeline`);
    return timelineData;
}

/**
 * Save timeline data to chat metadata
 */
export function saveTimelineData() {
    const context = getContext();
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    context.chatMetadata.tr_timeline = timelineData;
    context.saveMetadata();
    console.log(`Token Reducer: Saved ${timelineData.length} chapters to timeline`);
}

/**
 * Get the chapter timeline array
 * @returns {Array<{summary: string, startMsgId: number, endMsgId: number}>}
 */
export function getChapterTimeline() {
    return [...timelineData];
}

/**
 * Get a specific chapter's data
 * @param {number} chapterNumber - 1-indexed chapter number
 */
export function getChapter(chapterNumber) {
    if (chapterNumber < 1 || chapterNumber > timelineData.length) {
        return null;
    }
    return { ...timelineData[chapterNumber - 1], number: chapterNumber };
}

/**
 * Add a new chapter to the timeline
 * @param {string} summary - The chapter summary
 * @param {number} startMsgId - Starting message ID
 * @param {number} endMsgId - Ending message ID
 */
export function addChapter(summary, startMsgId, endMsgId) {
    const newChapter = {
        summary,
        startMsgId,
        endMsgId
    };
    timelineData.push(newChapter);
    saveTimelineData();
    console.log('Token Reducer: Added chapter to timeline:', newChapter);
    return timelineData.length; // Return the chapter number
}

/**
 * Update an existing chapter's summary
 * @param {number} chapterNumber - 1-indexed chapter number
 * @param {string} newSummary - The new summary text
 */
export function updateChapter(chapterNumber, newSummary) {
    if (chapterNumber < 1 || chapterNumber > timelineData.length) {
        return false;
    }
    timelineData[chapterNumber - 1].summary = newSummary;
    saveTimelineData();
    return true;
}

/**
 * Remove a chapter from the timeline
 * @param {number} chapterNumber - 1-indexed chapter number
 */
export function removeChapter(chapterNumber) {
    if (chapterNumber < 1 || chapterNumber > timelineData.length) {
        return null;
    }
    const removed = timelineData.splice(chapterNumber - 1, 1)[0];
    saveTimelineData();
    console.log('Token Reducer: Removed chapter:', removed);
    return removed;
}

/**
 * Get the timeline as formatted text for injection (like timeline-memory's {{timeline}})
 */
export function getTimelineForInjection() {
    if (timelineData.length === 0) {
        return '';
    }

    return timelineData.map((chapter, index) => {
        return `Chapter ${index + 1} (Messages ${chapter.startMsgId}-${chapter.endMsgId}): ${chapter.summary}`;
    }).join('\n\n');
}

/**
 * Get the number of chapters in the timeline
 */
export function getChapterCount() {
    return timelineData.length;
}


/**
 * Store a memory (to metadata and/or lorebook based on settings)
 */
export async function storeMemory(summary, keywords = null, options = {}) {
    const context = getContext();

    // Add to in-memory cache
    const memory = {
        type: options.type || 'custom',
        mesId: options.mesId,
        summary,
        keywords: keywords || [],
        timestamp: Date.now()
    };
    memoryCache.push(memory);

    // Store to lorebook if enabled
    if (settings.storage_mode === 'lorebook' || settings.storage_mode === 'both') {
        await storeToLorebook(summary, keywords, options);
    }

    return memory;
}

/**
 * Get or create a lorebook for storing memories
 * Based on MemoryBooks pattern using proper ST APIs
 */
async function getOrCreateLorebook() {
    const context = getContext();

    console.log('Token Reducer: getOrCreateLorebook called');
    console.log('Token Reducer: settings.target_lorebook:', settings.target_lorebook);
    console.log('Token Reducer: settings.auto_create_lorebook:', settings.auto_create_lorebook);
    console.log('Token Reducer: chat_metadata[METADATA_KEY]:', chat_metadata?.[METADATA_KEY]);

    // If manual target lorebook is specified, use it
    if (settings.target_lorebook) {
        try {
            const bookData = await loadWorldInfo(settings.target_lorebook);
            console.log('Token Reducer: Manual target lorebook loaded:', !!bookData, 'has entries:', bookData && 'entries' in bookData);
            if (bookData && 'entries' in bookData) {
                return { name: settings.target_lorebook, data: bookData, created: false };
            }
        } catch (err) {
            console.warn('Token Reducer: Failed to load manual target lorebook:', err);
        }
    }

    // Check if chat has a bound lorebook (using METADATA_KEY like MemoryBooks)
    const chatBoundLorebook = chat_metadata?.[METADATA_KEY];
    if (chatBoundLorebook) {
        try {
            const bookData = await loadWorldInfo(chatBoundLorebook);
            console.log('Token Reducer: Chat-bound lorebook loaded:', !!bookData, 'has entries:', bookData && 'entries' in bookData);
            if (bookData && 'entries' in bookData) {
                return { name: chatBoundLorebook, data: bookData, created: false };
            }
        } catch (err) {
            console.warn('Token Reducer: Failed to load chat-bound lorebook:', err);
        }
    }

    // Auto-create if enabled
    if (settings.auto_create_lorebook) {
        try {
            // Refresh global lorebook list first to ensure we have fresh data
            try {
                await updateWorldInfoList();
            } catch (e) {
                console.warn('Token Reducer: Initial updateWorldInfoList failed:', e);
            }

            const charName = context.name2 || 'Unknown';
            let bookName = settings.lorebook_name_template
                .replace('{{char}}', charName)
                .replace(/[\/\\:*?"<>|]/g, '_') // Sanitize for filesystem
                .replace(/_{2,}/g, '_')
                .substring(0, 60);

            console.log('Token Reducer: Auto-create enabled, desired book name:', bookName);

            // Check if name already exists and auto-number if needed
            if (world_names && world_names.includes(bookName)) {
                for (let i = 2; i <= 999; i++) {
                    const numberedName = `${bookName} ${i}`;
                    if (!world_names.includes(numberedName)) {
                        bookName = numberedName;
                        break;
                    }
                }
            }

            console.log('Token Reducer: Final book name (after numbering check):', bookName);

            // Check if it already exists in the list
            let exists = world_names && world_names.includes(bookName);
            let bookData = null;

            if (!exists) {
                // Create new lorebook using proper ST function
                console.log('Token Reducer: Creating new lorebook with createNewWorldInfo:', bookName);

                const created = await createNewWorldInfo(bookName);
                console.log('Token Reducer: createNewWorldInfo result:', created);

                if (!created) {
                    // Determine why it failed - maybe it existed on disk but not in list?
                    // Try to load it as fallback
                    try {
                        bookData = await loadWorldInfo(bookName);
                        if (bookData) {
                            console.log('Token Reducer: create failed but load succeeded (orphaned file?)');
                            exists = true; // Proceed to binding logic
                        } else {
                            throw new Error('createNewWorldInfo returned false');
                        }
                    } catch (e) {
                        throw new Error('createNewWorldInfo returned false');
                    }
                } else {
                    // Bind to current chat using METADATA_KEY (proper MemoryBooks pattern)
                    console.log('Token Reducer: Binding new lorebook to chat:', bookName);
                    chat_metadata[METADATA_KEY] = bookName;
                    await saveMetadata();

                    // Refresh global lorebook list so it appears in dropdown
                    try {
                        await updateWorldInfoList();
                    } catch (e) {
                        console.warn('Token Reducer: updateWorldInfoList failed:', e);
                    }

                    notify("success", `Created lorebook: ${bookName}`, 'Token Reducer');

                    // Load the newly created book
                    bookData = await loadWorldInfo(bookName);
                    return { name: bookName, data: bookData, created: true };
                }
            }

            // If we are here, it exists (or we fell back to it)
            if (!bookData) {
                try {
                    bookData = await loadWorldInfo(bookName);
                } catch (e) {
                    console.warn('Token Reducer: Failed to load existing lorebook:', e);
                    return null;
                }
            }

            console.log('Token Reducer: Book already exists, returning existing');

            // CRITICAL: Check if this book is bound to the current chat
            // If not, bind it now so World Info scans will find it
            if (chat_metadata[METADATA_KEY] !== bookName) {
                console.log('Token Reducer: Binding existing lorebook to chat. Was:', chat_metadata[METADATA_KEY]);
                chat_metadata[METADATA_KEY] = bookName;
                await saveMetadata();

                // Refresh list and editor
                try {
                    await updateWorldInfoList();
                } catch (e) { console.warn('Token Reducer: updateWorldInfoList error:', e); }

                console.log('Token Reducer: Call reloadEditor for existing bound book');
                reloadEditor(bookName);

                console.log('Token Reducer: Chat now bound to lorebook:', bookName);
            } else {
                console.log('Token Reducer: Lorebook already bound to chat');
            }

            return { name: bookName, data: bookData, created: false };
        } catch (err) {
            console.error('Token Reducer: Failed to create lorebook:', err);
            notify("error", `Failed to create lorebook: ${err.message}`, 'Token Reducer');
            return null;
        }
    }

    console.warn('Token Reducer: No lorebook available and auto-create is disabled');
    return null;
}

/**
 * Store a memory as a lorebook entry
 */
async function storeToLorebook(summary, keywords, options = {}) {
    console.log('Token Reducer: storeToLorebook START');
    console.log('Token Reducer: summary length:', summary?.length);
    console.log('Token Reducer: keywords:', keywords);
    console.log('Token Reducer: options:', JSON.stringify(options));

    try {
        // Get or create the lorebook
        console.log('Token Reducer: Calling getOrCreateLorebook...');
        const lorebook = await getOrCreateLorebook();

        if (!lorebook) {
            console.error('Token Reducer: getOrCreateLorebook returned null');
            return null;
        }

        const { name: bookName, data: bookData } = lorebook;
        console.log('Token Reducer: Got lorebook:', bookName);
        console.log('Token Reducer: bookData type:', typeof bookData);
        console.log('Token Reducer: bookData.entries type:', typeof bookData?.entries);
        console.log('Token Reducer: Existing entries count:', Object.keys(bookData?.entries || {}).length);

        // Generate keywords if not provided
        if (!keywords || keywords.length === 0) {
            console.log('Token Reducer: Generating keywords...');
            keywords = await generateKeywords(summary);
        }
        console.log('Token Reducer: Final keywords:', keywords);

        // Create the memory entry using SillyTavern's helper
        const timestamp = new Date().toLocaleString(); // Original line for timestamp
        // Create new entry
        console.log('Token Reducer: Calling createWorldInfoEntry with bookName:', bookName);
        const entry = createWorldInfoEntry(bookName, bookData);

        console.log('Token Reducer: createWorldInfoEntry returned:', entry);
        console.log('Token Reducer: Entry uid:', entry?.uid);

        if (!entry) {
            console.error('Token Reducer: createWorldInfoEntry returned null/undefined');
            return null;
        }

        // Populate entry fields
        entry.content = `${settings.memory_prefix || ''}${summary}${settings.memory_suffix || ''}`;
        entry.addMemo = true;
        entry.comment = options.title || `Memory - ${timestamp}`;
        entry.key = keywords;
        entry.position = 4; // Before main prompt
        entry.role = parseInt(settings.memory_role) || 0;
        entry.depth = settings.memory_depth || 4;
        entry.group = 'tr_memory';

        entry.probability = 100; // Always 100% probability
        entry.useGroupScoring = true;
        entry.selective = false;
        entry.constant = false;
        entry.vectorized = true;
        entry.disable = false;

        console.log('Token Reducer: Entry populated, content length:', entry.content?.length);
        console.log('Token Reducer: Entry keys:', entry.key);

        // Count entries in bookData after createWorldInfoEntry
        // createWorldInfoEntry modifies bookData in place!
        const entriesInObject = Object.keys(bookData?.entries || {}).length;
        console.log('Token Reducer: Entries in bookData object:', entriesInObject);

        // Save the world info using direct import (like MemoryBooks does)
        console.log('Token Reducer: Calling saveWorldInfo...');
        await saveWorldInfo(bookName, bookData, true);
        console.log('Token Reducer: saveWorldInfo completed');

        // Reload editor to show updates (if setting enabled)
        if (settings.refresh_editor) {
            console.log('Token Reducer: Calling reloadEditor...');
            reloadEditor(bookName);
            console.log('Token Reducer: reloadEditor completed');
        } else {
            console.log('Token Reducer: Skipping reloadEditor (setting disabled)');
        }

        // Verify by reloading
        console.log('Token Reducer: Verifying by reloading...');
        const reloadedData = await loadWorldInfo(bookName);
        const entriesOnDisk = Object.keys(reloadedData?.entries || {}).length;
        console.log('Token Reducer: Entries on disk:', entriesOnDisk);

        // Since we modified the object in place, entriesInObject should match entriesOnDisk if save was successful
        if (entriesOnDisk === entriesInObject && entriesInObject > 0) {
            console.log('Token Reducer: SUCCESS - Entry persisted! count:', entriesOnDisk);
        } else {
            console.warn('Token Reducer: WARNING - Disk count mismatch. Object:', entriesInObject, 'Disk:', entriesOnDisk);
        }

        console.log('Token Reducer: Stored memory to lorebook:', bookName);
        return entry;
    } catch (err) {
        console.error('Token Reducer: EXCEPTION in storeToLorebook:', err);
        console.error('Token Reducer: Error stack:', err.stack);
        return null;
    }
}

/**
 * Retrieve memories relevant to the current context
 */
/**
 * Retrieve memories relevant to the current context
 */
export async function retrieveRelevantMemories(queryText = null) {
    const context = getContext();
    const chat = context.chat;

    // Smart Retrieval: Generate query using LLM if enabled
    if (settings.enable_llm_retrieval && !queryText) {
        // Use last 10 messages for context
        const history = chat.slice(-10).map(m => `${m.name}: ${m.mes}`).join('\n');
        const llmQuery = await generateRetrievalQuery(history);
        if (llmQuery) {
            console.log(`Token Reducer: Generated retrieval query: "${llmQuery}"`);
            queryText = llmQuery;
        }
    }

    if (!queryText) {
        // Fallback: Use the last user message as query
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].is_user && !chat[i].is_system) {
                queryText = chat[i].mes;
                break;
            }
        }
    }

    if (!queryText) return [];

    // Simple keyword matching for now
    // TODO: Implement semantic similarity if vector DB is available
    const queryWords = queryText.toLowerCase().split(/\s+/);

    const scored = memoryCache.map(memory => {
        let score = 0;
        const summaryWords = memory.summary.toLowerCase().split(/\s+/);

        for (const word of queryWords) {
            if (word.length < 3) continue;
            if (summaryWords.some(w => w.includes(word))) {
                score++;
            }
        }

        // Boost recent memories
        const age = Date.now() - memory.timestamp;
        const agePenalty = age / (1000 * 60 * 60 * 24); // Days old
        score -= agePenalty * 0.1;

        return { memory, score };
    });

    // Sort by score and return top N
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, settings.max_retrieved_memories)
        .map(s => s.memory);
}

/**
 * Inject retrieved memories into the context
 */
export async function injectMemoriesIntoContext() {
    if (!settings.enable_smart_retrieval) return;

    const memories = await retrieveRelevantMemories();
    if (memories.length === 0) return;

    const context = getContext();

    // Build memory injection text
    const memoryText = memories.map(m =>
        `[Memory: ${m.summary}]`
    ).join('\n');

    // Store in chat metadata for injection
    if (!context.chatMetadata.tr_injected_memories) {
        context.chatMetadata.tr_injected_memories = [];
    }
    context.chatMetadata.tr_injected_memories = memoryText;

    // Use setExtensionPrompt to actually inject into the generation context
    setExtensionPrompt(
        RETRIEVAL_INJECT_KEY,
        memoryText,
        extension_prompt_types.IN_CHAT,
        settings.injection_depth || 0, // Reuse timeline depth or add new setting? defaulting to timeline depth for now
        false, // scan for WI
        settings.injection_role || extension_prompt_roles.SYSTEM
    );

    console.log(`Token Reducer: Injecting ${memories.length} memories`);

    return memories;
}

/**
 * Get messages that should be replaced with summaries in context
 */
export function getMessagesForReplacement() {
    if (!settings.replace_with_summary) return [];

    const context = getContext();
    const chat = context.chat;
    const replacements = [];

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.extra?.tr_summary && !msg.is_system) {
            replacements.push({
                mesId: i,
                originalLength: msg.mes.length,
                summaryLength: msg.extra.tr_summary.length,
                summary: msg.extra.tr_summary
            });
        }
    }

    return replacements;
}

/**
 * Get the last scene end position
 */
export function getLastSceneEnd() {
    return lastSceneEnd;
}

/**
 * Export all memories to JSON
 */
export function exportMemories() {
    const context = getContext();
    const exportData = {
        chatId: context.chatId,
        characterName: context.name2,
        exportedAt: new Date().toISOString(),
        memories: memoryCache
    };

    return JSON.stringify(exportData, null, 2);
}

/**
 * Import memories from JSON
 */
export async function importMemories(jsonData) {
    try {
        const data = JSON.parse(jsonData);

        if (!data.memories || !Array.isArray(data.memories)) {
            throw new Error('Invalid memory data format');
        }

        // Merge with existing memories (avoid duplicates by mesId)
        const existingIds = new Set(memoryCache.map(m => m.mesId));

        for (const memory of data.memories) {
            if (!existingIds.has(memory.mesId)) {
                memoryCache.push(memory);
            }
        }

        notify("success", `Imported ${data.memories.length} memories`, 'Token Reducer');
        return data.memories.length;
    } catch (err) {
        console.error('Token Reducer: Import failed:', err);
        notify("error", 'Failed to import memories', 'Token Reducer');
        return 0;
    }
}
/**
 * Generate a concise summary for a block of text
 */
async function generateSummary(text) {
    if (!text || !text.trim()) return null;

    const prompt = settings.summary_prompt.replace('{{content}}', text);

    try {
        const result = await ConnectionManagerRequestService.sendRequest(
            settings.summarization_profile,
            [{ role: 'user', content: prompt }]
        );
        return result?.content || result;
    } catch (err) {
        console.error('Token Reducer: Summary generation failed', err);
        return null;
    }
}



// Re-implementing correctly with ID injection
async function performArcAnalysis() {
    const context = getContext();
    const chat = context.chat;
    const lastSceneEnd = getLastSceneEnd();
    const startIndex = lastSceneEnd === -1 ? 0 : lastSceneEnd + 1;

    if (chat.length - startIndex < 5) {
        notify('warning', 'Not enough messages to analyze.', 'Token Reducer');
        return null;
    }

    // Get unchaptered messages with REAL IDs
    const messages = [];
    for (let i = startIndex; i < chat.length; i++) {
        messages.push({
            id: i,
            name: chat[i].name,
            text: chat[i].mes
        });
    }

    // Limit to reasonable size for context (last 100)
    const analysisWindow = messages.slice(-100);

    const historyText = analysisWindow.map(m =>
        `[ID: ${m.id}] ${m.name}: ${m.text.substring(0, 300)}`
    ).join('\n');

    // Get timeline summary for context
    const timeline = getChapterTimeline().map(c => `Chapter ${c.id}: ${c.summary}`).join('\n\n');
    let prompt = settings.arc_analyzer_prompt_template.replace('{{chapterHistory}}', historyText);
    prompt = prompt.replace('{{timeline}}', timeline);

    try {
        notify('info', 'Analyzing story arcs...', 'Token Reducer');

        // Use summarization profile (or arc profile if we added it, but let's reuse summarization for simplicity)
        const profile = settings.summarization_profile;
        if (!profile) throw new Error('No summarization profile selected in settings.');

        const response = await ConnectionManagerRequestService.sendRequest(
            profile,
            [{ role: 'user', content: prompt }]
        );

        const content = response?.content || response;
        console.log('Token Reducer: Arc Analysis Response:', content);

        // Robust JSON extraction
        let jsonStr = content;
        if (content.includes('```json')) {
            jsonStr = content.split('```json')[1].split('```')[0];
        } else if (content.includes('```')) {
            jsonStr = content.split('```')[1].split('```')[0];
        }

        // Find array bracket
        const start = jsonStr.indexOf('[');
        const end = jsonStr.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            jsonStr = jsonStr.substring(start, end + 1);
        }

        const arcs = JSON.parse(jsonStr);
        return arcs; // Returns array of { title, summary, chapterEnd ... }

    } catch (err) {
        throw err;
    }
}

/**
 * Show the Arc Analyzer Popup
 * @param {Array} arcs
 */
export async function showArcPopup(arcs) {
    if (!arcs || arcs.length === 0) {
        notify('info', 'No story arcs detected.', 'Token Reducer');
        return;
    }

    // Create Overlay
    const overlay = $(`<div class="rmr-arc-popup-overlay"></div>`);

    // Create Popup Content
    const popup = $(`
        <div class="rmr-arc-popup">
            <div class="rmr-arc-popup-header">
                <span class="rmr-arc-popup-title">Story Arc Analyzer</span>
                <button class="rmr-arc-popup-close">×</button>
            </div>
            <div class="rmr-arc-popup-body">
                <div class="rmr-arc-list"></div>
            </div>
        </div>
    `);

    const list = popup.find('.rmr-arc-list');

    // Populate List
    arcs.forEach(arc => {
        const item = $(`
            <div class="rmr-arc-item">
                <div class="rmr-arc-item-header">
                    <span class="rmr-arc-item-title">${arc.title}</span>
                    <span class="rmr-arc-item-meta">End ID: ${arc.chapterEnd}</span>
                </div>
                <div class="rmr-arc-item-summary">${arc.summary}</div>
                <div class="rmr-arc-item-justification">Analysis: ${arc.justification}</div>
                <button class="rmr-arc-item-btn">Create Chapter Here</button>
            </div>
        `);

        // Button Logic
        item.find('.rmr-arc-item-btn').on('click', async function () {
            const btn = $(this);
            btn.prop('disabled', true).text('Summarizing...');

            try {
                // Call summarizeScene from summarizer.js
                // We need to determine start ID.
                // It's strictly lastSceneEnd + 1
                const lastEnd = getLastSceneEnd();
                const startId = lastEnd + 1;

                await summarizeScene(startId, arc.chapterEnd);

                btn.text('✓ Completed').addClass('completed');
                item.addClass('completed');
                notify('success', `Chapter created: ${arc.title}`, 'Token Reducer');
            } catch (err) {
                console.error(err);
                notify('error', 'Failed to create chapter: ' + err.message, 'Token Reducer');
                btn.prop('disabled', false).text('Create Chapter Here');
            }
        });

        list.append(item);
    });

    // Close Logic
    popup.find('.rmr-arc-popup-close').on('click', () => overlay.remove());
    overlay.on('click', (e) => {
        if ($(e.target).is('.rmr-arc-popup-overlay')) overlay.remove();
    });

    overlay.append(popup);
    $('body').append(overlay);
}

// Wrapper for the command
export async function analyzeAndShowArcs() {
    try {
        const arcs = await performArcAnalysis();
        await showArcPopup(arcs);
        return arcs ? `Found ${arcs.length} potential arcs.` : 'No arcs found.';
    } catch (err) {
        return `Error: ${err.message}`;
    }
}




/**
 * Generate a search query for retrieval using LLM
 */
async function generateRetrievalQuery(chatHistory) {
    const prompt = settings.retrieval_query_prompt.replace('{{content}}', chatHistory);
    try {
        const result = await ConnectionManagerRequestService.sendRequest(
            settings.summarization_profile,
            [{ role: 'user', content: prompt }]
        );
        return (result?.content || result || '').trim();
    } catch (err) {
        console.error('Token Reducer: Retrieval query generation failed', err);
        return null;
    }
}
