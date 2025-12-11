/**
 * Settings Management for Token Reducer
 */

import { extension_settings, getContext } from "../../../../extensions.js";
import { ConnectionManagerRequestService } from "../../../../extensions/shared.js";
import { extension_name } from "../index.js";
import { summarizeAllMessages, clearAllSummaries } from "./summarizer.js";
import { getMemories, exportMemories, getChapterTimeline, loadTimelineData, removeChapter, updateChapter } from "./memory-manager.js";
import { updateTokenDisplay } from "./token-tracker.js";

// Default settings - all features toggleable
const defaultSettings = {
    // Per-Message Summarization
    enable_message_summary: false,
    auto_summarize: false,
    auto_summarize_user: false,
    auto_summarize_on_edit: false,
    auto_summarize_on_swipe: true,
    auto_summarize_on_continue: false,
    summary_delay_messages: 5,
    replace_with_summary: false,

    // Auto-Hide Summarized Messages
    collapse_summarized: false, // Collapse/hide messages after summarizing (visual only)
    auto_hide_summarized: false, // Actually hide from AI context (like /hide command)
    keep_recent_count: 5, // Number of recent summarized messages to keep visible (not hidden)
    collapse_style: 'compact', // 'minimal' (just icon), 'compact' (one-line), 'hidden' (fully hidden)

    // Scene/Chapter Summarization
    enable_scene_mode: false,
    auto_detect_scenes: false,
    scene_button: true,
    hide_summarized_scenes: false,

    // Memory Storage
    storage_mode: 'metadata', // 'metadata', 'lorebook', 'both'
    target_lorebook: '',
    auto_create_lorebook: true, // Auto-create lorebook if none exists
    lorebook_name_template: 'TR_Memories_{{char}}', // Template for auto-created lorebook name
    lorebook_probability: 100,
    refresh_editor: true, // Refresh World Info panel after adding memories
    popup_memories: false,
    popup_probability: 10,
    memory_depth: 4,
    memory_role: 0, // 0=system, 1=user, 2=assistant

    // Token Threshold Management
    enable_threshold: true,
    token_threshold_pct: 70,
    summarize_oldest_first: true,
    aggressive_mode: false,
    show_token_counter: true,

    // Smart Context Retrieval
    enable_smart_retrieval: false,
    retrieval_on_send: false,
    max_retrieved_memories: 5,
    retrieval_prompt: '',

    // Generation Settings
    summarization_profile: '', // Connection profile ID for summarization
    rate_limit: 60, // requests per minute
    show_notifications: 'all', // 'all', 'errors', 'none'

    // Prompts
    summary_prompt: `Summarize the following message briefly in plain text. No markdown, no asterisks, no alternatives. Just a simple one-sentence summary:

{{content}}

Summary:`,

    keywords_prompt: `Extract 3-5 important keywords from this text that could trigger this memory later. Return only comma-separated keywords:

{{content}}

Keywords:`,

    scene_summary_prompt: `Summarize the following scene/chapter in a concise paragraph. Include key events, character developments, and important details:

{{content}}

Scene Summary:`,

    // Timeline Injection Settings
    enable_injection: false,
    injection_depth: 0, // 0 = at the end, higher = further back
    injection_role: 0, // 0 = system, 1 = user, 2 = assistant
    injection_template: `[Timeline Summary - Previous Events]
{{timeline}}

[Recent Context Retrieved]
{{timelineResponses}}`,

    // Presets - stored configurations
    presets: [],
    current_preset: '',
};

// Current settings (will be loaded from extension_settings)
export let settings = { ...defaultSettings };

/**
 * Show notification if allowed by settings
 * @param {string} type - 'success', 'info', 'warning', 'error'
 * @param {string} message - The notification message
 * @param {string} title - Optional title
 */
/**
 * Show notification if allowed by settings
 * @param {string} type - 'success', 'info', 'warning', 'error'
 * @param {string} message - The notification message
 * @param {string} title - Optional title
 */
export function notify(type, message, title = 'Token Reducer') {
    // Errors always show unless notifications are completely off
    if (settings.show_notifications === 'none') return;

    // If only errors, only show error and warning
    if (settings.show_notifications === 'errors') {
        if (type !== 'error' && type !== 'warning') return;
    }

    // Show the notification using the global toastr object
    // FIX: Use toastr instead of recursively calling notify()
    if (typeof toastr !== 'undefined') {
        switch (type) {
            case 'success':
                toastr.success(message, title);
                break;
            case 'info':
                toastr.info(message, title);
                break;
            case 'warning':
                toastr.warning(message, title);
                break;
            case 'error':
                toastr.error(message, title);
                break;
            default:
                toastr.info(message, title);
        }
    } else {
        console.log(`[${title}] ${type}: ${message}`);
    }
}
/**
 * Load settings from extension storage
 */
export async function loadSettings() {
    // Initialize extension settings if not present
    if (!extension_settings[extension_name]) {
        extension_settings[extension_name] = {};
    }

    // Merge saved settings with defaults
    settings = { ...defaultSettings, ...extension_settings[extension_name] };

    // Load the settings UI
    await loadSettingsUI();

    // Apply current values to UI
    applySettingsToUI();
}

/**
 * Save current settings to extension storage
 */
export function saveSettings() {
    extension_settings[extension_name] = { ...settings };
    getContext().saveSettingsDebounced();
}

/**
 * Load settings panel HTML
 */
async function loadSettingsUI() {
    const settingsHtml = await $.get(`scripts/extensions/third-party/${extension_name}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // Initialize the connection profile dropdown using ConnectionManagerRequestService
    try {
        ConnectionManagerRequestService.handleDropdown(
            '#tr_summarization_profile',
            settings.summarization_profile || '',
            async (profile) => {
                // onChange handler
                settings.summarization_profile = profile?.id || '';
                saveSettings();
                console.log('Token Reducer: Summarization profile changed to:', settings.summarization_profile);
            },
            () => { }, // onCreate
            () => { }, // onUpdate
            () => { }  // onDelete
        );
    } catch (err) {
        console.warn('Token Reducer: Connection Manager not available, profile dropdown disabled', err);
        $('#tr_summarization_profile').prop('disabled', true).html('<option value="">Connection Manager not available</option>');
    }

    // Bind event handlers
    bindSettingsHandlers();
}

/**
 * Apply current settings to UI elements
 */
function applySettingsToUI() {
    // Per-Message Summarization
    $('#tr_enable_message_summary').prop('checked', settings.enable_message_summary);
    $('#tr_auto_summarize').prop('checked', settings.auto_summarize);
    $('#tr_auto_summarize_user').prop('checked', settings.auto_summarize_user);
    $('#tr_auto_summarize_on_edit').prop('checked', settings.auto_summarize_on_edit);
    $('#tr_auto_summarize_on_swipe').prop('checked', settings.auto_summarize_on_swipe);
    $('#tr_auto_summarize_on_continue').prop('checked', settings.auto_summarize_on_continue);
    $('#tr_summary_delay_messages').val(settings.summary_delay_messages);
    $('#tr_replace_with_summary').prop('checked', settings.replace_with_summary);

    // Auto-Hide Summarized Messages
    $('#tr_collapse_summarized').prop('checked', settings.collapse_summarized);
    $('#tr_auto_hide_summarized').prop('checked', settings.auto_hide_summarized);
    $('#tr_keep_recent_count').val(settings.keep_recent_count);
    $('#tr_collapse_style').val(settings.collapse_style);

    // Scene/Chapter Summarization
    $('#tr_enable_scene_mode').prop('checked', settings.enable_scene_mode);
    $('#tr_auto_detect_scenes').prop('checked', settings.auto_detect_scenes);
    $('#tr_scene_button').prop('checked', settings.scene_button);
    $('#tr_hide_summarized_scenes').prop('checked', settings.hide_summarized_scenes);

    // Memory Storage
    $('#tr_storage_mode').val(settings.storage_mode);
    $('#tr_target_lorebook').val(settings.target_lorebook);
    $('#tr_auto_create_lorebook').prop('checked', settings.auto_create_lorebook);
    $('#tr_lorebook_name_template').val(settings.lorebook_name_template);
    $('#tr_refresh_editor').prop('checked', settings.refresh_editor);

    $('#tr_popup_memories').prop('checked', settings.popup_memories);
    $('#tr_popup_probability').val(settings.popup_probability);
    $('#tr_popup_probability_value').text(settings.popup_probability + '%');
    $('#tr_memory_depth').val(settings.memory_depth);
    $('#tr_memory_role').val(settings.memory_role);

    // Token Threshold
    $('#tr_enable_threshold').prop('checked', settings.enable_threshold);
    $('#tr_token_threshold_pct').val(settings.token_threshold_pct);
    $('#tr_token_threshold_pct_value').text(settings.token_threshold_pct + '%');
    $('#tr_summarize_oldest_first').prop('checked', settings.summarize_oldest_first);
    $('#tr_aggressive_mode').prop('checked', settings.aggressive_mode);
    $('#tr_show_token_counter').prop('checked', settings.show_token_counter);

    // Smart Retrieval
    $('#tr_enable_smart_retrieval').prop('checked', settings.enable_smart_retrieval);
    $('#tr_retrieval_on_send').prop('checked', settings.retrieval_on_send);
    $('#tr_max_retrieved_memories').val(settings.max_retrieved_memories);

    // Generation Settings
    // Note: summarization_profile is handled by ConnectionManagerRequestService.handleDropdown
    $('#tr_rate_limit').val(settings.rate_limit);
    $('#tr_show_notifications').val(settings.show_notifications);

    // Prompts
    $('#tr_summary_prompt').val(settings.summary_prompt);
    $('#tr_keywords_prompt').val(settings.keywords_prompt);
    $('#tr_scene_summary_prompt').val(settings.scene_summary_prompt);

    // Timeline Injection
    $('#tr_enable_injection').prop('checked', settings.enable_injection);
    $('#tr_injection_depth').val(settings.injection_depth);
    $('#tr_injection_depth_value').text(settings.injection_depth);
    $('#tr_injection_role').val(settings.injection_role);
    $('#tr_injection_template').val(settings.injection_template);

    // Update visibility of dependent settings
    updateDependentSettings();
}

/**
 * Bind event handlers to settings UI
 */
function bindSettingsHandlers() {
    // Toggle handlers
    const toggles = [
        'enable_message_summary', 'auto_summarize', 'auto_summarize_user',
        'auto_summarize_on_edit', 'auto_summarize_on_swipe', 'auto_summarize_on_continue',
        'replace_with_summary', 'collapse_summarized', 'auto_hide_summarized',
        'enable_scene_mode', 'auto_detect_scenes', 'scene_button', 'hide_summarized_scenes',
        'popup_memories', 'auto_create_lorebook', 'refresh_editor', 'enable_threshold', 'summarize_oldest_first',
        'aggressive_mode', 'show_token_counter', 'enable_smart_retrieval',
        'retrieval_on_send', 'enable_injection'
    ];

    toggles.forEach(name => {
        $(`#tr_${name}`).on('change', function () {
            settings[name] = $(this).prop('checked');
            saveSettings();
            updateDependentSettings();
        });
    });

    // Number input handlers
    const numbers = [
        'summary_delay_messages', 'memory_depth', 'max_retrieved_memories', 'rate_limit', 'keep_recent_count'
    ];

    numbers.forEach(name => {
        $(`#tr_${name}`).on('input', function () {
            settings[name] = parseInt($(this).val()) || 0;
            saveSettings();
        });
    });

    // Range slider handlers (with display update)
    const ranges = [
        { name: 'popup_probability', suffix: '%' },
        { name: 'token_threshold_pct', suffix: '%' },
        { name: 'injection_depth', suffix: '' }
    ];

    ranges.forEach(({ name, suffix }) => {
        $(`#tr_${name}`).on('input', function () {
            const val = parseInt($(this).val());
            settings[name] = val;
            $(`#tr_${name}_value`).text(val + suffix);
            saveSettings();
        });
    });

    // Select handlers
    const selects = ['storage_mode', 'memory_role', 'collapse_style', 'show_notifications', 'injection_role'];

    selects.forEach(name => {
        $(`#tr_${name}`).on('change', function () {
            settings[name] = $(this).val();
            saveSettings();
            updateDependentSettings();
        });
    });

    // Text input handlers
    const texts = ['target_lorebook', 'lorebook_name_template', 'connection_profile_id'];

    texts.forEach(name => {
        $(`#tr_${name}`).on('input', function () {
            settings[name] = $(this).val();
            saveSettings();
        });
    });

    // Textarea handlers (prompts)
    const textareas = ['summary_prompt', 'keywords_prompt', 'scene_summary_prompt', 'injection_template'];

    textareas.forEach(name => {
        $(`#tr_${name}`).on('input', function () {
            settings[name] = $(this).val();
            saveSettings();
        });
    });

    // Reset prompts button
    $('#tr_reset_prompts').on('click', function () {
        settings.summary_prompt = defaultSettings.summary_prompt;
        settings.keywords_prompt = defaultSettings.keywords_prompt;
        settings.scene_summary_prompt = defaultSettings.scene_summary_prompt;
        applySettingsToUI();
        saveSettings();
        notify("success", 'Prompts reset to defaults', 'Token Reducer');
    });

    // Quick Action Buttons
    $('#tr_summarize_all').on('click', async function () {
        const button = $(this);
        button.prop('disabled', true).find('i').removeClass('fa-compress').addClass('fa-spinner fa-spin');
        try {
            const count = await summarizeAllMessages();
            updateTokenDisplay();
            notify("success", `Summarized ${count} messages`, 'Token Reducer');
        } catch (err) {
            console.error('Token Reducer: Summarize all failed:', err);
            notify("error", 'Failed to summarize messages', 'Token Reducer');
        } finally {
            button.prop('disabled', false).find('i').removeClass('fa-spinner fa-spin').addClass('fa-compress');
        }
    });

    $('#tr_clear_summaries').on('click', async function () {
        const button = $(this);
        const confirmed = await getContext().Popup.show.confirm(
            'Clear All Summaries',
            'Are you sure you want to clear all summaries from this chat? This cannot be undone.'
        );
        if (!confirmed) return;

        button.prop('disabled', true).find('i').removeClass('fa-trash').addClass('fa-spinner fa-spin');
        try {
            const count = await clearAllSummaries();
            updateTokenDisplay();
            notify("success", `Cleared ${count} summaries`, 'Token Reducer');
        } catch (err) {
            console.error('Token Reducer: Clear summaries failed:', err);
            notify("error", 'Failed to clear summaries', 'Token Reducer');
        } finally {
            button.prop('disabled', false).find('i').removeClass('fa-spinner fa-spin').addClass('fa-trash');
        }
    });

    // Memory Viewer
    $(document).on('click', '.tr-memory-copy-btn', function () {
        const summary = decodeURIComponent($(this).data('summary'));
        navigator.clipboard.writeText(summary);
        notify("success", "Summary copied to clipboard", "Token Reducer");
        const icon = $(this).find('i');
        icon.removeClass('fa-copy').addClass('fa-check');
        setTimeout(() => icon.removeClass('fa-check').addClass('fa-copy'), 1000);
    });

    $(document).on('click', '#tr_copy_all_memories', function () {
        const memories = getMemories();
        const text = memories.map(m => {
            const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : 'Unknown';
            return `[${m.type.toUpperCase()}] ${time}\n${m.summary}\n`;
        }).join('\n-------------------\n\n');

        navigator.clipboard.writeText(text);
        notify("success", "All memories copied to clipboard", "Token Reducer");

        const btn = $(this);
        const originalText = btn.html();
        btn.html('<i class="fa-solid fa-check"></i> Copied!');
        setTimeout(() => btn.html(originalText), 2000);
    });

    $('#tr_view_memories').on('click', async function () {
        const memories = getMemories();

        if (memories.length === 0) {
            notify("info", 'No memories recorded yet. Summarize some messages first!', 'Token Reducer');
            return;
        }

        // Build a formatted display of memories
        const memoryList = memories.map((m, i) => {
            const typeIcon = m.type === 'scene' ? '📖' : m.type === 'message' ? '💬' : '🧠';
            const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : 'Unknown';
            const fullSummary = m.summary || '';
            const preview = fullSummary.substring(0, 300);
            const encodedSummary = encodeURIComponent(fullSummary);

            return `<div class="tr-memory-item">
                <div class="tr-memory-header">
                    <span>${typeIcon} ${m.type.charAt(0).toUpperCase() + m.type.slice(1)} ${m.mesId !== undefined ? `#${m.mesId}` : ''}</span>
                    <div class="tr-memory-actions">
                        <div class="tr-memory-copy-btn" title="Copy Summary" data-summary="${encodedSummary}">
                            <i class="fa-solid fa-copy"></i>
                        </div>
                    </div>
                </div>
                <div class="tr-memory-time">${time}</div>
                <div class="tr-memory-summary" title="${fullSummary}">${preview}${preview.length >= 300 ? '...' : ''}</div>
            </div>`;
        }).join('');

        await getContext().Popup.show.text(
            'Stored Memories',
            `<div class="tr-memories-popup">
                <div class="tr-popup-controls" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span>${memories.length} memories stored for this chat</span>
                    <button id="tr_copy_all_memories" class="menu_button"><i class="fa-solid fa-copy"></i> Copy All</button>
                </div>
                <div class="tr-memories-list">${memoryList}</div>
            </div>`,
            { wide: true }
        );
    });

    $('#tr_export_memories').on('click', async function () {
        const button = $(this);
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

            notify("success", 'Memories exported successfully', 'Token Reducer');
        } catch (err) {
            console.error('Token Reducer: Export failed:', err);
            notify("error", 'Failed to export memories', 'Token Reducer');
        }
    });

    // Collapsible sections
    $('.tr-section-header').on('click', function () {
        $(this).next('.tr-section-content').slideToggle(200);
        $(this).find('.tr-collapse-icon').toggleClass('fa-chevron-down fa-chevron-up');
    });

    // Timeline refresh button
    $('#tr_refresh_timeline').on('click', function () {
        loadTimelineData();
        renderTimelineList();
    });

    // Initial timeline render
    loadTimelineData();
    renderTimelineList();

    // Initialize preset dropdown
    updatePresetDropdown();

    // Preset handlers
    $('#tr_save_preset').on('click', function () {
        const name = $('#tr_preset_name').val();
        if (savePreset(name)) {
            $('#tr_preset_name').val('');
        }
    });

    $('#tr_load_preset').on('click', function () {
        const name = $('#tr_preset_select').val();
        if (name) {
            loadPreset(name);
        }
    });

    $('#tr_delete_preset').on('click', async function () {
        const name = $('#tr_preset_select').val();
        if (!name) return;

        const confirmed = await getContext().Popup.show.confirm(
            'Delete Preset',
            `Are you sure you want to delete the preset "${name}"?`
        );
        if (confirmed) {
            deletePreset(name);
        }
    });

    $('#tr_export_preset').on('click', function () {
        const name = $('#tr_preset_select').val();
        if (!name) {
            notify("warning", "Select a preset to export", "Token Reducer");
            return;
        }
        const json = exportPreset(name);
        if (json) {
            navigator.clipboard.writeText(json);
            notify("success", "Preset copied to clipboard", "Token Reducer");
        }
    });

    $('#tr_import_preset').on('click', async function () {
        const json = await getContext().Popup.show.input(
            'Import Preset',
            'Paste the preset JSON:',
            { rows: 6 }
        );
        if (json) {
            importPreset(json);
        }
    });
}

/**
 * Render the chapter timeline list in the settings UI
 */
export function renderTimelineList() {
    const container = $('#tr_timeline_list');
    const chapters = getChapterTimeline();

    if (chapters.length === 0) {
        container.html('<div class="tr-timeline-empty">No chapters yet. End a scene to create a chapter.</div>');
        return;
    }

    let html = '';
    chapters.forEach((chapter, index) => {
        const chapterNum = index + 1;
        const summaryPreview = chapter.summary.length > 150
            ? chapter.summary.substring(0, 150) + '...'
            : chapter.summary;

        html += `
            <div class="tr-chapter-item" data-chapter="${chapterNum}">
                <div class="tr-chapter-header">
                    <span class="tr-chapter-title">Chapter ${chapterNum}</span>
                    <span class="tr-chapter-range">Messages ${chapter.startMsgId}—${chapter.endMsgId}</span>
                </div>
                <div class="tr-chapter-summary">${summaryPreview}</div>
                <div class="tr-chapter-actions">
                    <button class="menu_button tr-edit-chapter" data-chapter="${chapterNum}" title="Edit summary">
                        <i class="fa-solid fa-edit"></i>
                    </button>
                    <button class="menu_button tr-delete-chapter" data-chapter="${chapterNum}" title="Delete chapter">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.html(html);

    // Bind chapter action handlers
    container.find('.tr-edit-chapter').on('click', async function () {
        const chapterNum = parseInt($(this).data('chapter'));
        const chapters = getChapterTimeline();
        const chapter = chapters[chapterNum - 1];

        const newSummary = await getContext().Popup.show.input(
            `Edit Chapter ${chapterNum} Summary`,
            chapter.summary,
            { rows: 6 }
        );

        if (newSummary && newSummary !== chapter.summary) {
            updateChapter(chapterNum, newSummary);
            renderTimelineList();
            notify("success", `Chapter ${chapterNum} updated`, 'Token Reducer');
        }
    });

    container.find('.tr-delete-chapter').on('click', async function () {
        const chapterNum = parseInt($(this).data('chapter'));
        const confirmed = await getContext().Popup.show.confirm(
            'Delete Chapter',
            `Are you sure you want to delete Chapter ${chapterNum}? This cannot be undone.`
        );

        if (confirmed) {
            removeChapter(chapterNum);
            renderTimelineList();
            notify("success", `Chapter ${chapterNum} deleted`, 'Token Reducer');
        }
    });
}

/**
 * Update visibility of settings that depend on other settings
 */
function updateDependentSettings() {
    // Auto-summarize depends on message summary being enabled
    $('#tr_auto_summarize').closest('.tr-setting-row').toggle(settings.enable_message_summary);
    $('#tr_auto_summarize_user').closest('.tr-setting-row').toggle(settings.enable_message_summary && settings.auto_summarize);
    $('#tr_auto_summarize_on_edit').closest('.tr-setting-row').toggle(settings.enable_message_summary && settings.auto_summarize);
    $('#tr_auto_summarize_on_swipe').closest('.tr-setting-row').toggle(settings.enable_message_summary && settings.auto_summarize);
    $('#tr_auto_summarize_on_continue').closest('.tr-setting-row').toggle(settings.enable_message_summary && settings.auto_summarize);
    $('#tr_summary_delay_messages').closest('.tr-setting-row').toggle(settings.enable_message_summary && settings.auto_summarize);
    $('#tr_replace_with_summary').closest('.tr-setting-row').toggle(settings.enable_message_summary);

    // Auto-hide settings depend on message summary
    $('#tr_collapse_summarized').closest('.tr-setting-row').toggle(settings.enable_message_summary);
    $('#tr_auto_hide_summarized').closest('.tr-setting-row').toggle(settings.enable_message_summary);
    $('#tr_keep_recent_count').closest('.tr-setting-row').toggle(settings.enable_message_summary && settings.auto_hide_summarized);
    $('#tr_collapse_style').closest('.tr-setting-row').toggle(settings.enable_message_summary && settings.collapse_summarized);

    // Scene settings depend on scene mode
    $('#tr_auto_detect_scenes').closest('.tr-setting-row').toggle(settings.enable_scene_mode);
    $('#tr_scene_button').closest('.tr-setting-row').toggle(settings.enable_scene_mode);
    $('#tr_hide_summarized_scenes').closest('.tr-setting-row').toggle(settings.enable_scene_mode);

    // Lorebook settings depend on storage mode
    const showLorebook = settings.storage_mode === 'lorebook' || settings.storage_mode === 'both';
    $('#tr_target_lorebook').closest('.tr-setting-row').toggle(showLorebook);
    $('#tr_auto_create_lorebook').closest('.tr-setting-row').toggle(showLorebook);
    $('#tr_lorebook_name_template').closest('.tr-setting-row').toggle(showLorebook && settings.auto_create_lorebook);
    $('#tr_refresh_editor').closest('.tr-setting-row').toggle(showLorebook);

    $('#tr_popup_memories').closest('.tr-setting-row').toggle(showLorebook);
    $('#tr_popup_probability').closest('.tr-setting-row').toggle(showLorebook && settings.popup_memories);

    // Threshold settings
    $('#tr_token_threshold_pct').closest('.tr-setting-row').toggle(settings.enable_threshold);
    $('#tr_summarize_oldest_first').closest('.tr-setting-row').toggle(settings.enable_threshold);
    $('#tr_aggressive_mode').closest('.tr-setting-row').toggle(settings.enable_threshold);

    // Smart retrieval settings
    $('#tr_retrieval_on_send').closest('.tr-setting-row').toggle(settings.enable_smart_retrieval);
    $('#tr_max_retrieved_memories').closest('.tr-setting-row').toggle(settings.enable_smart_retrieval);
}

/**
 * Get a setting value
 */
export function getSetting(key) {
    return settings[key];
}

/**
 * Set a setting value
 */
export function setSetting(key, value) {
    if (key in settings) {
        settings[key] = value;
        saveSettings();
        return true;
    }
    return false;
}

// ============ PRESET MANAGEMENT ============

/**
 * Get list of saved presets
 */
export function getPresetList() {
    return settings.presets || [];
}

/**
 * Get settings to include in a preset (excludes presets array itself)
 */
function getPresetableSettings() {
    const excluded = ['presets', 'current_preset'];
    const presetable = {};
    for (const key in settings) {
        if (!excluded.includes(key)) {
            presetable[key] = settings[key];
        }
    }
    return presetable;
}

/**
 * Save current settings as a new preset
 * @param {string} name - Name for the preset
 */
export function savePreset(name) {
    if (!name || !name.trim()) {
        notify("warning", "Please enter a preset name", "Token Reducer");
        return false;
    }

    name = name.trim();

    // Check if preset with this name already exists
    const existingIndex = settings.presets.findIndex(p => p.name === name);

    const preset = {
        name,
        timestamp: Date.now(),
        settings: getPresetableSettings()
    };

    if (existingIndex >= 0) {
        // Update existing preset
        settings.presets[existingIndex] = preset;
        notify("success", `Preset "${name}" updated`, "Token Reducer");
    } else {
        // Add new preset
        settings.presets.push(preset);
        notify("success", `Preset "${name}" saved`, "Token Reducer");
    }

    settings.current_preset = name;
    saveSettings();
    updatePresetDropdown();
    return true;
}

/**
 * Load a saved preset
 * @param {string} name - Name of the preset to load
 */
export function loadPreset(name) {
    const preset = settings.presets.find(p => p.name === name);
    if (!preset) {
        notify("warning", `Preset "${name}" not found`, "Token Reducer");
        return false;
    }

    // Preserve the presets array and current_preset
    const presets = settings.presets;

    // Apply preset settings
    Object.assign(settings, preset.settings);

    // Restore presets array
    settings.presets = presets;
    settings.current_preset = name;

    saveSettings();
    applySettingsToUI();
    notify("success", `Preset "${name}" loaded`, "Token Reducer");
    return true;
}

/**
 * Delete a saved preset
 * @param {string} name - Name of the preset to delete
 */
export function deletePreset(name) {
    const index = settings.presets.findIndex(p => p.name === name);
    if (index < 0) {
        notify("warning", `Preset "${name}" not found`, "Token Reducer");
        return false;
    }

    settings.presets.splice(index, 1);
    if (settings.current_preset === name) {
        settings.current_preset = '';
    }

    saveSettings();
    updatePresetDropdown();
    notify("success", `Preset "${name}" deleted`, "Token Reducer");
    return true;
}

/**
 * Export a preset as JSON for sharing
 * @param {string} name - Name of the preset to export
 */
export function exportPreset(name) {
    const preset = settings.presets.find(p => p.name === name);
    if (!preset) {
        notify("warning", `Preset "${name}" not found`, "Token Reducer");
        return null;
    }
    return JSON.stringify(preset, null, 2);
}

/**
 * Import a preset from JSON
 * @param {string} jsonString - JSON string of the preset
 */
export function importPreset(jsonString) {
    try {
        const preset = JSON.parse(jsonString);
        if (!preset.name || !preset.settings) {
            throw new Error("Invalid preset format");
        }

        // Check for conflicts
        const existingIndex = settings.presets.findIndex(p => p.name === preset.name);
        if (existingIndex >= 0) {
            preset.name = preset.name + ' (imported)';
        }

        settings.presets.push(preset);
        saveSettings();
        updatePresetDropdown();
        notify("success", `Preset "${preset.name}" imported`, "Token Reducer");
        return true;
    } catch (err) {
        notify("error", "Failed to import preset: " + err.message, "Token Reducer");
        return false;
    }
}

/**
 * Update the preset dropdown in the UI
 */
function updatePresetDropdown() {
    const dropdown = $('#tr_preset_select');
    if (!dropdown.length) return;

    dropdown.empty();
    dropdown.append('<option value="">Select a preset...</option>');

    settings.presets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.name;
        option.textContent = preset.name;
        if (preset.name === settings.current_preset) {
            option.selected = true;
        }
        dropdown.append(option);
    });
}
