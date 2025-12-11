/**
 * Message UI Integration - Buttons and Display
 */

import { getContext } from "../../../../extensions.js";
import { settings, notify } from "./settings.js";
import { summarizeMessage, summarizeScene, findLastSceneEnd, isMessageSummarized, isSceneEnd, getMessageSummary } from "./summarizer.js";
import { updateTokenDisplay } from "./token-tracker.js";

/**
 * Handle message rendered event
 */
export function onMessageRendered(mesId, type) {
    const message = $(`.mes[mesid="${mesId}"]`);
    if (!message.length) return;

    addMessageButtons(message);
    addSummaryDisplay(message, mesId);
}

/**
 * Add summarization buttons to a message
 */
export function addMessageButtons(messageElement) {
    const mesId = parseInt(messageElement.attr('mesid'));
    if (isNaN(mesId)) return;

    const extraButtons = messageElement.find('.extraMesButtons');
    if (!extraButtons.length) return;

    // Remove existing TR buttons
    extraButtons.find('.tr-button').remove();

    // Add summarize button
    if (settings.enable_message_summary) {
        const summarizeBtn = $(`
            <div class="tr-button tr-summarize-btn fa-solid fa-compress interactable" 
                 title="Summarize this message" 
                 data-mesid="${mesId}">
            </div>
        `);

        summarizeBtn.on('click', async function (e) {
            e.stopPropagation();
            const mid = parseInt($(this).data('mesid'));
            await summarizeMessage(mid);
            addSummaryDisplay(messageElement, mid);
            updateTokenDisplay();
        });

        extraButtons.append(summarizeBtn);

        // Edit Summary Button
        const editBtn = $(`
            <div class="tr-button tr-edit-btn fa-solid fa-pen-to-square interactable" 
                 title="Edit Summary (Token Reducer)" 
                 data-mesid="${mesId}">
            </div>
        `);

        editBtn.on('click', function (e) {
            e.stopPropagation();
            const mid = parseInt($(this).data('mesid'));
            const summary = getMessageSummary(mid);
            editSummary(mid, summary);
        });

        extraButtons.append(editBtn);
    }

    // Add scene end button
    if (settings.enable_scene_mode && settings.scene_button) {
        const sceneBtn = $(`
            <div class="tr-button tr-scene-btn fa-solid fa-flag-checkered interactable" 
                 title="End scene here (summarize from last scene)" 
                 data-mesid="${mesId}">
            </div>
        `);

        sceneBtn.on('click', async function (e) {
            e.stopPropagation();
            const mid = parseInt($(this).data('mesid'));
            const lastEnd = findLastSceneEnd(mid);
            const startId = lastEnd + 1;

            await summarizeScene(startId, mid);
            resetMessageButtons();
            updateTokenDisplay();
        });

        extraButtons.append(sceneBtn);
    }

    // Update button states
    updateButtonStates(messageElement, mesId);
}

/**
 * Update button states based on summarization status
 */
function updateButtonStates(messageElement, mesId) {
    const summarized = isMessageSummarized(mesId);
    const sceneEnd = isSceneEnd(mesId);

    const summarizeBtn = messageElement.find('.tr-summarize-btn');
    if (summarized) {
        summarizeBtn.addClass('tr-done').attr('title', 'Already summarized (click to re-summarize)');
    }

    const sceneBtn = messageElement.find('.tr-scene-btn');
    if (sceneEnd) {
        sceneBtn.addClass('tr-done').attr('title', 'Scene end (click to view summary)');
    }
}

/**
 * Add summary display below a message
 */
function addSummaryDisplay(messageElement, mesId) {
    // Remove existing display
    messageElement.find('.tr-summary-display').remove();

    const summary = getMessageSummary(mesId);
    if (!summary) return;

    const context = getContext();
    const message = context.chat[mesId];

    // Determine status color
    let statusClass = 'tr-summary-included';
    if (settings.replace_with_summary) {
        statusClass = 'tr-summary-active';
    }

    const display = $(`
        <div class="tr-summary-display ${statusClass}">
            <span class="tr-summary-label">Summary:</span>
            <span class="tr-summary-text">${escapeHtml(summary)}</span>
            <span class="tr-summary-edit fa-solid fa-pen-to-square" title="Edit summary"></span>
        </div>
    `);

    // Edit handler
    display.find('.tr-summary-edit').on('click', function (e) {
        e.stopPropagation();
        editSummary(mesId, summary);
    });

    messageElement.find('.mes_text').after(display);
}

/**
 * Edit a message summary
 */
async function editSummary(mesId, currentSummary) {
    const result = await getContext().Popup.show.input(
        'Edit Summary',
        'Modify the summary for this message:',
        currentSummary,
        { rows: 4 }
    );

    if (result === null) return; // Cancelled

    const context = getContext();
    const message = context.chat[mesId];

    if (!message.extra) message.extra = {};
    message.extra.tr_summary = result;
    message.extra.tr_summarized_at = Date.now();

    await context.saveChat();

    // Update display
    const messageElement = $(`.mes[mesid="${mesId}"]`);
    addSummaryDisplay(messageElement, mesId);
    updateTokenDisplay();

    notify("success", 'Summary updated', 'Token Reducer');
}

/**
 * Reset all message buttons (e.g., after chat change)
 */
export function resetMessageButtons() {
    $('.mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'));
        if (!isNaN(mesId)) {
            addMessageButtons($(this));
            addSummaryDisplay($(this), mesId);
        }
    });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Apply collapse state to summarized messages based on settings
 */
export function applyCollapseStates() {
    if (!settings.collapse_summarized) return;

    const context = getContext();
    const chat = context.chat;
    const totalMessages = chat.length;

    // Find all summarized messages
    $('.mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'));
        if (isNaN(mesId)) return;

        const messageElement = $(this); // Renamed to avoid conflict with chat[mesId]
        const message = chat[mesId];
        if (!message?.extra?.tr_summary) return;

        // Check if this message should be collapsed (outside the keep_recent_count)
        const messagesFromEnd = totalMessages - 1 - mesId;
        const shouldCollapse = messagesFromEnd >= settings.keep_recent_count;

        if (shouldCollapse) {
            collapseMessage($(this), mesId);
        } else {
            expandMessage($(this), mesId);
        }
    });
}

/**
 * Collapse a single message based on collapse_style setting
 */
function collapseMessage(messageElement, mesId) {
    if (messageElement.hasClass('tr-collapsed')) return;

    const context = getContext();
    const message = context.chat[mesId];
    const summary = message?.extra?.tr_summary || 'Summarized message';

    // Store original content for later restoration
    if (!messageElement.data('tr-original-mes-text')) {
        messageElement.data('tr-original-mes-text', messageElement.find('.mes_text').html());
    }

    messageElement.addClass('tr-collapsed');

    switch (settings.collapse_style) {
        case 'hidden':
            // Fully hide the message
            messageElement.addClass('tr-hidden');
            break;

        case 'minimal':
            // Show just an icon bar
            messageElement.addClass('tr-minimal');
            const minimalBar = $(`
                <div class="tr-collapsed-bar tr-minimal-bar">
                    <i class="fa-solid fa-compress"></i>
                    <span class="tr-collapsed-label">Message summarized</span>
                    <i class="fa-solid fa-chevron-down tr-expand-btn" title="Expand message"></i>
                </div>
            `);
            minimalBar.find('.tr-expand-btn').on('click', () => toggleMessageCollapse(messageElement, mesId));
            messageElement.find('.mes_block').prepend(minimalBar);
            break;

        case 'compact':
        default:
            // Show one-line summary preview
            messageElement.addClass('tr-compact');
            const compactBar = $(`
                <div class="tr-collapsed-bar tr-compact-bar">
                    <i class="fa-solid fa-compress"></i>
                    <span class="tr-collapsed-summary">${escapeHtml(summary.substring(0, 100))}${summary.length > 100 ? '...' : ''}</span>
                    <i class="fa-solid fa-chevron-down tr-expand-btn" title="Expand message"></i>
                </div>
            `);
            compactBar.find('.tr-expand-btn').on('click', () => toggleMessageCollapse(messageElement, mesId));
            messageElement.find('.mes_block').prepend(compactBar);
            break;
    }
}

/**
 * Expand a collapsed message
 */
function expandMessage(messageElement, mesId) {
    if (!messageElement.hasClass('tr-collapsed')) return;

    messageElement.removeClass('tr-collapsed tr-hidden tr-minimal tr-compact');
    messageElement.find('.tr-collapsed-bar').remove();

    // Restore original content if it was modified
    const originalContent = messageElement.data('tr-original-mes-text');
    if (originalContent) {
        messageElement.find('.mes_text').html(originalContent);
        messageElement.removeData('tr-original-mes-text');
    }
}

/**
 * Toggle collapse state for a message
 */
function toggleMessageCollapse(messageElement, mesId) {
    if (messageElement.hasClass('tr-collapsed')) {
        expandMessage(messageElement, mesId);
    } else {
        collapseMessage(messageElement, mesId);
    }
}

/**
 * Collapse a message after summarization if settings allow
 */
export function collapseAfterSummarize(mesId) {
    if (!settings.collapse_summarized) return;

    const context = getContext();
    const totalMessages = context.chat.length;
    const messagesFromEnd = totalMessages - 1 - mesId;

    // Only collapse if outside the keep_recent_count
    if (messagesFromEnd >= settings.keep_recent_count) {
        const messageElement = $(`.mes[mesid="${mesId}"]`);
        if (messageElement.length) {
            collapseMessage(messageElement, mesId);
        }
    }
}
