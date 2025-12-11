import { getContext } from "../../../../extensions.js";
import { settings } from "./settings.js";


/**
 * Update the token savings display in the settings panel
 */
export async function updateTokenDisplay() {
    const savings = await getTotalSavings();

    // Update savings display
    $('#tr_original_tokens').text(savings.original.toLocaleString() + ' tokens');
    $('#tr_reduced_tokens').text(savings.current.toLocaleString() + ' tokens');

    // Show actual or potential savings
    if (settings.replace_with_summary) {
        $('#tr_saved_tokens').text(`${savings.saved.toLocaleString()} tokens (${savings.savedPercent}%)`);
    } else if (savings.totalSummaries > 0) {
        // Show potential savings if replace_with_summary is off
        const potentialPercent = savings.original > 0
            ? Math.round((savings.potentialSaved / savings.original) * 100)
            : 0;
        $('#tr_saved_tokens').text(`${savings.potentialSaved.toLocaleString()} tokens potential (${potentialPercent}%)`);
    } else {
        $('#tr_saved_tokens').text('0 tokens (0%)');
    }

    $('#tr_summarized_count').text(savings.totalSummaries);

    // Show/hide savings based on whether there are any summaries
    if (savings.totalSummaries > 0) {
        $('#tr_savings_display').show();
    } else {
        $('#tr_savings_display').hide();
    }
}

// checkTokenThreshold has been removed - not needed when auto-summarize is enabled


/**
 * Estimate token savings if a message were summarized
 */
export async function estimateSavings(mesId) {
    const context = getContext();
    const message = context.chat[mesId];

    if (!message || message.is_system) return 0;

    const originalTokens = await context.getTokenCountAsync(message.mes);

    // Estimate summary will be ~25% of original (rough estimate)
    const estimatedSummaryTokens = Math.ceil(originalTokens * 0.25);

    return {
        original: originalTokens,
        estimated: estimatedSummaryTokens,
        savings: originalTokens - estimatedSummaryTokens
    };
}

/**
 * Get token breakdown by message
 */
export async function getTokenBreakdown() {
    const context = getContext();
    const chat = context.chat;

    const breakdown = [];

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.is_system) continue;

        const tokens = await context.getTokenCountAsync(msg.mes);
        const hasSummary = !!msg.extra?.tr_summary;
        let summaryTokens = 0;

        if (hasSummary) {
            summaryTokens = await context.getTokenCountAsync(msg.extra.tr_summary);
        }

        breakdown.push({
            mesId: i,
            name: msg.name,
            isUser: msg.is_user,
            tokens,
            hasSummary,
            summaryTokens,
            savings: hasSummary ? tokens - summaryTokens : 0
        });
    }

    return breakdown;
}

/**
 * Get total token savings from summarization
 */
export async function getTotalSavings() {
    const breakdown = await getTokenBreakdown();

    let totalOriginal = 0;
    let totalWithSummaries = 0;
    let summarizedCount = 0;

    for (const item of breakdown) {
        totalOriginal += item.tokens;

        if (item.hasSummary && settings.replace_with_summary) {
            totalWithSummaries += item.summaryTokens;
            summarizedCount++;
        } else {
            totalWithSummaries += item.tokens;
        }
    }

    return {
        original: totalOriginal,
        current: totalWithSummaries,
        saved: totalOriginal - totalWithSummaries,
        savedPercent: totalOriginal > 0
            ? Math.round((1 - totalWithSummaries / totalOriginal) * 100)
            : 0,
        summarizedCount,
        // Also track potential savings (if replace_with_summary were enabled)
        potentialSaved: breakdown.reduce((acc, item) => acc + item.savings, 0),
        totalSummaries: breakdown.filter(item => item.hasSummary).length
    };
}
