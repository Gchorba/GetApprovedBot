const { App } = require('@slack/bolt');
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;

// Create directories if they don't exist
const publicDir = path.join(__dirname, 'public');
const dbDir = path.join(__dirname, '.data');

if (!require('fs').existsSync(publicDir)){
    require('fs').mkdirSync(publicDir);
}
if (!require('fs').existsSync(dbDir)){
    require('fs').mkdirSync(dbDir);
}

// In-memory storage for approvals and channel
let loggingChannelId = null;
const pendingApprovals = new Map();

// Channel storage functions
async function loadStoredChannel() {
    try {
        const data = await fs.readFile(path.join(dbDir, 'channel.json'), 'utf8');
        const channelData = JSON.parse(data);
        loggingChannelId = channelData.channelId;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('Error loading stored channel:', err);
        }
    }
}

async function saveChannel() {
    try {
        await fs.writeFile(
            path.join(dbDir, 'channel.json'),
            JSON.stringify({ channelId: loggingChannelId }, null, 2)
        );
    } catch (err) {
        console.error('Error saving channel:', err);
    }
}

// Initialize the app with token-based auth
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: false,
    port: process.env.PORT || 3000
});

// Helper function to get channel setup view
function getChannelSetupView() {
    return {
        type: "modal",
        callback_id: "channel-selection-modal",
        title: {
            type: "plain_text",
            text: "First Time Setup",
        },
        submit: {
            type: "plain_text",
            text: "Next",
        },
        close: {
            type: "plain_text",
            text: "Cancel",
        },
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "Welcome! Please select a channel where approval activities will be logged."
                }
            },
            {
                type: "input",
                block_id: "logging_channel",
                element: {
                    type: "channels_select",
                    placeholder: {
                        type: "plain_text",
                        text: "Select a channel",
                    },
                    action_id: "channel_select"
                },
                label: {
                    type: "plain_text",
                    text: "Logging Channel",
                },
                hint: {
                    type: "plain_text",
                    text: "The bot will be added to this channel to log approval activities"
                }
            }
        ]
    };
}

// Helper function to get approval view
function getApprovalView() {
    return {
        type: "modal",
        callback_id: "request-approval-modal",
        title: {
            type: "plain_text",
            text: "Submit for Approval",
        },
        submit: {
            type: "plain_text",
            text: "Submit",
        },
        close: {
            type: "plain_text",
            text: "Cancel",
        },
        blocks: [
            {
                type: "input",
                block_id: "approvers_selection",
                element: {
                    type: "multi_users_select",
                    placeholder: {
                        type: "plain_text",
                        text: "Choose approvers",
                    },
                    action_id: "selected_approvers",
                },
                label: {
                    type: "plain_text",
                    text: "Approvers",
                },
            },
            {
                type: "input",
                block_id: "url_block",
                element: {
                    type: "url_text_input",
                    action_id: "url_input",
                    placeholder: {
                        type: "plain_text",
                        text: "Enter URL",
                    },
                },
                label: {
                    type: "plain_text",
                    text: "URL for Review",
                },
            },
            {
                type: "input",
                block_id: "details_block",
                element: {
                    type: "plain_text_input",
                    action_id: "details_input",
                    multiline: true,
                },
                label: {
                    type: "plain_text",
                    text: "Details for Approval",
                },
            },
            {
                type: "actions",
                block_id: "channel_actions",
                elements: [
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Change Logging Channel",
                            emoji: true,
                        },
                        action_id: "change_channel",
                        style: "primary"
                    }
                ]
            }
        ]
    };
}

// Function to log approval activities
async function logToRecordkeeping(client, message) {
    try {
        if (!loggingChannelId) {
            console.warn('Warning: No logging channel configured');
            return;
        }

        await client.chat.postMessage({
            channel: loggingChannelId,
            text: message,
            unfurl_links: false
        });
    } catch (err) {
        console.error('Error logging to channel:', err);
    }
}

// Command handler for /getapproved
app.command("/getapproved", async ({ ack, body, client }) => {
    await ack();

    try {
        const view = loggingChannelId ? getApprovalView() : getChannelSetupView();
        await client.views.open({
            trigger_id: body.trigger_id,
            view: view
        });
    } catch (err) {
        console.error('Error handling command:', err);
        try {
            await client.chat.postMessage({
                channel: body.user_id,
                text: "Sorry, something went wrong. Please try again."
            });
        } catch (notifyError) {
            console.error('Error notifying user:', notifyError);
        }
    }
});

// Handle initial channel selection
app.view("channel-selection-modal", async ({ ack, view, client }) => {
    try {
        const channelId = view.state.values.logging_channel.channel_select.selected_channel;

        try {
            await client.conversations.join({ channel: channelId });
            console.log(`Successfully joined channel ${channelId}`);
            
            loggingChannelId = channelId;
            await saveChannel();

            await client.chat.postMessage({
                channel: channelId,
                text: "👋 I'll be logging approval activities in this channel."
            });

            await ack({
                response_action: "update",
                view: getApprovalView()
            });
        } catch (joinError) {
            console.error('Error joining channel:', joinError);
            await ack({
                response_action: "errors",
                errors: {
                    "logging_channel": "Unable to join this channel. Please ensure the bot has been invited or choose a different channel."
                }
            });
        }
    } catch (err) {
        console.error('Error handling channel selection:', err);
        await ack({
            response_action: "errors",
            errors: {
                "logging_channel": "Failed to process channel selection. Please try again."
            }
        });
    }
});

// Handle change channel button
app.action('change_channel', async ({ ack, body, client }) => {
    await ack();

    try {
        await client.views.push({
            trigger_id: body.trigger_id,
            view: {
                type: "modal",
                callback_id: "change-channel-modal-update",
                title: {
                    type: "plain_text",
                    text: "Change Logging Channel",
                },
                submit: {
                    type: "plain_text",
                    text: "Save",
                },
                close: {
                    type: "plain_text",
                    text: "Cancel",
                },
                blocks: [
                    {
                        type: "input",
                        block_id: "new_logging_channel",
                        element: {
                            type: "channels_select",
                            placeholder: {
                                type: "plain_text",
                                text: "Select a channel",
                            },
                            action_id: "channel_select"
                        },
                        label: {
                            type: "plain_text",
                            text: "New Logging Channel",
                        }
                    }
                ],
                private_metadata: body.view.id
            }
        });
    } catch (err) {
        console.error('Error opening change channel modal:', err);
    }
});

// Handle channel change submission
app.view('change-channel-modal-update', async ({ ack, body, view, client }) => {
    const channelId = view.state.values.new_logging_channel.channel_select.selected_channel;
    const parentViewId = view.private_metadata;

    try {
        await client.conversations.join({ channel: channelId });
        console.log(`Successfully joined channel ${channelId}`);
        
        // Update stored channel
        loggingChannelId = channelId;
        await saveChannel();

        // Acknowledge first
        await ack();

        // Send confirmation message
        await client.chat.postMessage({
            channel: channelId,
            text: "👋 I'll now use this channel for logging approval activities."
        });

        // Update the parent view if it exists
        if (parentViewId) {
            try {
                await client.views.update({
                    view_id: parentViewId,
                    view: getApprovalView()
                });
            } catch (updateError) {
                console.error('Error updating parent view:', updateError);
            }
        }
    } catch (joinError) {
        console.error('Error joining channel:', joinError);
        await ack({
            response_action: "errors",
            errors: {
                "new_logging_channel": "Unable to join this channel. Please ensure the bot has been invited or choose a different channel."
            }
        });
    }
});

// Handle modal submission
app.view("request-approval-modal", async ({ ack, body, client, view }) => {
    try {
        const approverIds = view.state.values.approvers_selection.selected_approvers.selected_users;
        const requestUrl = view.state.values.url_block.url_input.value;
        const requestDetails = view.state.values.details_block.details_input.value;
        const requesterId = body.user.id;

        // Generate a unique request ID
        const requestId = `req_${Date.now()}_${requesterId}`;

        // Store the approval request details
        pendingApprovals.set(requestId, {
            requesterId,
            approverIds,
            approvals: new Set(),
            rejections: new Set(),
            url: requestUrl,
            details: requestDetails,
            status: 'PENDING'
        });

        // Get approver names for logging
        const approverNames = await Promise.all(
            approverIds.map(async (id) => {
                try {
                    const result = await client.users.info({ user: id });
                    return result.user.real_name || result.user.name;
                } catch (error) {
                    console.error(`Error fetching user info for ${id}:`, error);
                    return id;
                }
            })
        );

        // Log new approval request
        await logToRecordkeeping(client, 
            `🆕 *New Approval Request*\n` +
            `• *Requester:* <@${requesterId}>\n` +
            `• *Approvers:* ${approverNames.join(', ')}\n` +
            `• *URL:* ${requestUrl}\n` +
            `• *Details:* ${requestDetails}\n` +
            `• *Request ID:* ${requestId}`
        );

        const messageText = `Approval requested:\n*${requestDetails}*\n*URL:* ${requestUrl}`;
        const requesterInfo = `*Requested By:*\n<@${requesterId}>`;
        const approversInfo = `*Approvers:*\n${approverNames.join(', ')}`;

        // Send message to all approvers
        for (const approverId of approverIds) {
            try {
                await client.chat.postMessage({
                    channel: approverId,
                    text: `You have a new approval request:\n${requestDetails}\nURL: ${requestUrl}`,
                    blocks: [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: messageText,
                            },
                        },
                        {
                            type: "section",
                            fields: [
                                {
                                    type: "mrkdwn",
                                    text: requesterInfo,
                                },
                                {
                                    type: "mrkdwn",
                                    text: "*Status:*\nPending",
                                },
                                {
                                    type: "mrkdwn",
                                    text: approversInfo,
                                },
                                {
                                    type: "mrkdwn",
                                    text: "*Required Approvals:*\nAll",
                                },
                            ],
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: {
                                        type: "plain_text",
                                        emoji: true,
                                        text: "Approve",
                                    },
                                    style: "primary",
                                    value: `approve_${requestId}`,
                                    action_id: "approve_action",
                                },
                                {
                                    type: "button",
                                    text: {
                                        type: "plain_text",
                                        emoji: true,
                                        text: "Reject",
                                    },
                                    style: "danger",
                                    value: `reject_${requestId}`,
                                    action_id: "reject_action",
                                },
                            ],
                        },
                    ],
                });
            } catch (error) {
                console.error(`Error sending message to approver ${approverId}:`, error);
            }
        }

        // Send confirmation to requester
        await client.chat.postMessage({
            channel: requesterId,
            text: `Your request has been sent to ${approverIds.length} approver${approverIds.length > 1 ? 's' : ''}\n*Description*: ${requestDetails}\n*URL*: ${requestUrl}`,
        });

        await ack();
    } catch (err) {
        console.error('Error handling modal submission:', err);
        await ack({
            response_action: "errors",
            errors: {
                "approvers_selection": "Failed to process request. Please try again."
            }
        });
    }
});

// Handle approve action
app.action("approve_action", async ({ ack, body, client, action }) => {
    try {
        await ack();
        
        const requestId = action.value.replace('approve_', '');
        const approverId = body.user.id;
        
        const request = pendingApprovals.get(requestId);
        
        if (!request || request.status !== 'PENDING') {
            await client.chat.postMessage({
                channel: approverId,
                text: "This request is no longer active or has already been processed."
            });
            return;
        }

        request.approvals.add(approverId);
        
        try {
            // Get approver name for current approver
            const approverInfo = await client.users.info({ user: approverId });
            const approverName = approverInfo.user.real_name || approverInfo.user.name;

            // Get names of all who have approved
            const approvedNames = await Promise.all(
                Array.from(request.approvals).map(async (id) => {
                    try {
                        const result = await client.users.info({ user: id });
                        return result.user.real_name || result.user.name;
                    } catch (error) {
                        console.error(`Error fetching user info for ${id}:`, error);
                        return id;
                    }
                })
            );

            // Update the message
            await client.chat.update({
                channel: body.container.channel_id,
                ts: body.container.message_ts,
                text: `Approval request - ${request.approvals.size}/${request.approverIds.length} approvals received`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `Approval request:\n*${request.details}*\n*URL:* ${request.url}`,
                        },
                    },
                    {
                        type: "section",
                        fields: [
                            {
                                type: "mrkdwn",
                                text: `*Requested By:*\n<@${request.requesterId}>`,
                            },
                            {
                                type: "mrkdwn",
                                text: `*Status:*\n${request.approvals.size}/${request.approverIds.length} Approvals`,
                            },
                            {
                                type: "mrkdwn",
                                text: `*Approvers:*\n${approvedNames.join(', ')}`,
                            },
                        ],
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    emoji: true,
                                    text: "Approve",
                                },
                                style: "primary",
                                value: `approve_${requestId}`,
                                action_id: "approve_action",
                            },
                            {
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    emoji: true,
                                    text: "Reject",
                                },
                                style: "danger",
                                value: `reject_${requestId}`,
                                action_id: "reject_action",
                            },
                        ],
                    },
                ],
            });

            if (request.approvals.size === request.approverIds.length) {
                request.status = 'APPROVED';
                
                // Only notify requester of completion
                await client.chat.postMessage({
                    channel: request.requesterId,
                    text: `Your request has been fully approved!\n*URL:* ${request.url}`,
                });

                // Log completion with user names instead of tags
                const approverNames = await Promise.all(
                    Array.from(request.approvals).map(async (id) => {
                        try {
                            const result = await client.users.info({ user: id });
                            return result.user.real_name || result.user.name;
                        } catch (error) {
                            console.error(`Error fetching user info for ${id}:`, error);
                            return id;
                        }
                    })
                );

                await logToRecordkeeping(client,
                    `✅ *Approval Request Completed*\n` +
                    `• *Requester:* <@${request.requesterId}>\n` +
                    `• *Status:* Approved\n` +
                    `• *URL:* ${request.url}\n` +
                    `• *Approvers:* ${approverNames.join(', ')}\n` +
                    `• *Request ID:* ${requestId}`
                );
            } else {
                // Get remaining approver names
                const remainingApprovers = request.approverIds.filter(id => !request.approvals.has(id));
                const remainingNames = await Promise.all(
                    remainingApprovers.map(async (id) => {
                        try {
                            const result = await client.users.info({ user: id });
                            return result.user.real_name || result.user.name;
                        } catch (error) {
                            console.error(`Error fetching user info for ${id}:`, error);
                            return id;
                        }
                    })
                );

                // Only notify requester of partial approval
                await client.chat.postMessage({
                    channel: request.requesterId,
                    text: `Your request was approved by ${approverName}. Waiting for ${remainingApprovers.length} more approver(s):\n${remainingNames.join(', ')}\n*URL:* ${request.url}`,
                });

                // Log partial approval with names instead of tags
                await logToRecordkeeping(client,
                    `👍 *Partial Approval*\n` +
                    `• *Requester:* <@${request.requesterId}>\n` +
                    `• *Approved By:* ${approverName}\n` +
                    `• *Remaining Approvers:* ${remainingNames.join(', ')}\n` +
                    `• *URL:* ${request.url}\n` +
                    `• *Request ID:* ${requestId}`
                );
            }
        } catch (updateError) {
            console.error('Error updating message:', updateError);
        }
    } catch (err) {
        console.error('Error handling approve action:', err);
    }
});

// Handle reject action
app.action("reject_action", async ({ ack, body, client, action }) => {
    try {
        await ack();
        
        const requestId = action.value.replace('reject_', '');
        const approverId = body.user.id;
        
        const request = pendingApprovals.get(requestId);
        
        if (!request || request.status !== 'PENDING') {
            await client.chat.postMessage({
                channel: approverId,
                text: "This request is no longer active or has already been processed."
            });
            return;
        }

        request.status = 'REJECTED';
        request.rejections.add(approverId);
        
        try {
            // Get rejector name
            const rejectorInfo = await client.users.info({ user: approverId });
            const rejectorName = rejectorInfo.user.real_name || rejectorInfo.user.name;

            await client.chat.update({
                channel: body.container.channel_id,
                ts: body.container.message_ts,
                text: `Approval request - REJECTED by ${rejectorName}`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `Approval request:\n*${request.details}*\n*URL:* ${request.url}\n\n*REJECTED* by ${rejectorName}`,
                        },
                    },
                    {
                        type: "section",
                        fields: [
                            {
                                type: "mrkdwn",
                                text: `*Requested By:*\n<@${request.requesterId}>`,
                            },
                            {
                                type: "mrkdwn",
                                text: "*Status:*\nREJECTED",
                            }
                        ],
                    },
                ],
            });

            // Only notify requester
            await client.chat.postMessage({
                channel: request.requesterId,
                text: `Your request was rejected by ${rejectorName}.\n*URL:* ${request.url}`,
            });

            // Log rejection with name instead of tag
            await logToRecordkeeping(client,
                `❌ *Approval Request Rejected*\n` +
                `• *Requester:* <@${request.requesterId}>\n` +
                `• *Rejected By:* ${rejectorName}\n` +
                `• *URL:* ${request.url}\n` +
                `• *Request ID:* ${requestId}`
            );
        } catch (updateError) {
            console.error('Error updating message:', updateError);
        }
    } catch (err) {
        console.error('Error handling reject action:', err);
    }
});

// Start the app
(async () => {
    try {
        await loadStoredChannel(); // Load stored channel
        await app.start();
        console.log(`⚡️ Slack app is running on port ${process.env.PORT || 3000}`);
    } catch (error) {
        console.error('Unable to start app:', error);
        process.exit(1);
    }
})();