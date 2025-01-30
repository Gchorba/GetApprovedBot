const { App, ExpressReceiver, FileInstallationStore } = require('@slack/bolt');
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;

// Create directories if they don't exist
const publicDir = path.join(__dirname, 'public');
const dbDir = path.join(__dirname, '.data');
const CHANNEL_STORAGE_FILE = path.join(__dirname, '.data', 'channels.json');

if (!require('fs').existsSync(publicDir)){
    require('fs').mkdirSync(publicDir);
}
if (!require('fs').existsSync(dbDir)){
    require('fs').mkdirSync(dbDir);
}

// Initialize FileInstallationStore
const installationStore = new FileInstallationStore({
    baseDir: path.join(__dirname, '.data'),
    clientId: process.env.SLACK_CLIENT_ID,
});

// Updated scopes configuration
const SLACK_BOT_SCOPES = [
    'app_mentions:read',
    'channels:history',
    'channels:read',
    'channels:join',
    'channels:manage',
    'chat:write',
    'commands',
    'groups:history',
    'groups:read',
    'im:history',
    'im:read',
    'im:write',
    'mpim:history',
    'mpim:read',
    'mpim:write',
    'users:read',
    'team:read'
];

// In-memory storage for approvals and channels
const pendingApprovals = new Map();
global.teamChannels = new Map();

// Initialize ExpressReceiver
const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    stateSecret: process.env.STATE_SECRET || 'my-state-secret',
    scopes: SLACK_BOT_SCOPES,
    installationStore,
    installerOptions: {
        directInstall: true,
    },
    endpoints: {
        events: '/slack/events',
        commands: '/slack/commands',
        oauth_redirect: '/oauth_redirect'
    }
});

// Initialize the app
const slackApp = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    stateSecret: process.env.STATE_SECRET || 'my-state-secret',
    scopes: SLACK_BOT_SCOPES,
    installationStore,
    receiver,
    installerOptions: {
        directInstall: true,
    },
});

// Channel storage functions
async function loadStoredChannels() {
    try {
        const data = await fs.readFile(CHANNEL_STORAGE_FILE, 'utf8');
        const channels = JSON.parse(data);
        global.teamChannels = new Map(Object.entries(channels));
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('Error loading stored channels:', err);
        }
    }
}

async function saveChannels() {
    try {
        const channelsObj = Object.fromEntries(global.teamChannels);
        await fs.writeFile(CHANNEL_STORAGE_FILE, JSON.stringify(channelsObj, null, 2));
    } catch (err) {
        console.error('Error saving channels:', err);
    }
}

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
                    text: "Welcome! Before we begin, please select a channel where approval activities will be logged."
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
function getApprovalView(channelId) {
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
        ],
        private_metadata: channelId
    };
}

// Add logging middleware
receiver.router.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// Serve static files
receiver.router.use(express.static(publicDir));

// OAuth routes
receiver.router.get('/', (req, res) => {
    res.send(`
        <h1>Slack Approval App</h1>
        <a href="/slack/install"><img alt="Add to Slack" height="40" width="139" 
        src="https://platform.slack-edge.com/img/add_to_slack.png" 
        srcSet="https://platform.slack-edge.com/img/add_to_slack.png 1x, 
        https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>
    `);
});

// Function to log approval activities
async function logToRecordkeeping(client, message, teamId) {
    try {
        const channelId = global.teamChannels.get(teamId);
        
        if (!channelId) {
            console.warn(`Warning: No logging channel configured for team ${teamId}`);
            return;
        }

        await client.chat.postMessage({
            channel: channelId,
            text: message,
            unfurl_links: false
        });
    } catch (err) {
        console.error('Error logging to channel:', err);
    }
}

// Command handler for /getapproved
slackApp.command("/getapproved", async ({ ack, body, client }) => {
    // Acknowledge immediately
    await ack();

    try {
        const teamId = body.team_id;
        const channelId = global.teamChannels.get(teamId);
        const view = channelId ? getApprovalView(channelId) : getChannelSetupView();

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

// Handle channel change submission
slackApp.view('change-channel-modal', async ({ ack, body, view, client }) => {
    try {
        const channelId = view.state.values.new_logging_channel.channel_select.selected_channel;
        const teamId = body.team.id;
        
        // Try to join the selected channel
        try {
            await client.conversations.join({ channel: channelId });
            console.log(`Successfully joined channel ${channelId}`);
            
            // Update stored channel
            global.teamChannels.set(teamId, channelId);
            await saveChannels();
            
            // Acknowledge the view submission first
            await ack();

            // If there's a previous view, update it
            if (view.private_metadata && body.view.previous_view) {
                const previousView = body.view.previous_view;
                previousView.private_metadata = channelId;
                
                try {
                    await client.views.update({
                        view_id: view.private_metadata,
                        view: previousView
                    });
                } catch (updateError) {
                    console.error('Error updating previous view:', updateError);
                }
            }

            // Send confirmation message
            try {
                await client.chat.postMessage({
                    channel: channelId,
                    text: "👋 I'll now use this channel for logging approval activities."
                });
            } catch (messageError) {
                console.error('Error sending confirmation message:', messageError);
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
    } catch (err) {
        console.error('Error handling channel change:', err);
        if (!body.response_sent) {
            await ack({
                response_action: "errors",
                errors: {
                    "new_logging_channel": "Failed to process channel change. Please try again."
                }
            });
        }
    }
});

// Handle change channel button click
slackApp.action('change_channel', async ({ ack, body, client }) => {
    try {
        await ack();

        const viewId = body.view ? body.view.id : undefined;
        
        await client.views.push({
            trigger_id: body.trigger_id,
            view: {
                type: "modal",
                callback_id: "change-channel-modal",
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
                private_metadata: viewId || ''
            }
        });
    } catch (err) {
        console.error('Error opening change channel modal:', err);
    }
});

// Handle channel change submission
slackApp.view('change-channel-modal', async ({ ack, body, view, client }) => {
    try {
        const channelId = view.state.values.new_logging_channel.channel_select.selected_channel;
        const teamId = body.team.id;
        
        try {
            await client.conversations.join({ channel: channelId });
            console.log(`Successfully joined channel ${channelId}`);
            
            // Update stored channel
            global.teamChannels.set(teamId, channelId);
            await saveChannels();
            
            await ack();

            // Update the parent view's metadata
            await client.views.update({
                view_id: view.private_metadata,
                view: {
                    ...JSON.parse(JSON.stringify(body.view.previous_view)),
                    private_metadata: channelId
                }
            });

            // Send confirmation message
            await client.chat.postMessage({
                channel: channelId,
                text: "👋 I'll now use this channel for logging approval activities."
            });
        } catch (joinError) {
            console.error('Error joining channel:', joinError);
            await ack({
                response_action: "errors",
                errors: {
                    "new_logging_channel": "Unable to join this channel. Please ensure the bot has been invited or choose a different channel."
                }
            });
            return;
        }
    } catch (err) {
        console.error('Error handling channel change:', err);
        await ack({
            response_action: "errors",
            errors: {
                "new_logging_channel": "Failed to process channel change. Please try again."
            }
        });
    }
});

// Handle modal submission
slackApp.view("request-approval-modal", async ({ ack, body, client, view }) => {
    try {
        const channelId = view.private_metadata;
        const approverIds = view.state.values.approvers_selection.selected_approvers.selected_users;
        const requestUrl = view.state.values.url_block.url_input.value;
        const requestDetails = view.state.values.details_block.details_input.value;
        const requesterId = body.user.id;
        const teamId = body.team.id;

        // Generate a unique request ID
        const requestId = `req_${Date.now()}_${requesterId}`;

        // Log new approval request
await logToRecordkeeping(client, 
            `🆕 *New Approval Request*\n` +
            `• *Requester:* <@${requesterId}>\n` +
            `• *Approvers:* ${approverIds.map(id => `<@${id}>`).join(', ')}\n` +
            `• *URL:* ${requestUrl}\n` +
            `• *Details:* ${requestDetails}\n` +
            `• *Request ID:* ${requestId}`,
            teamId
        );

        // Store the approval request details
        pendingApprovals.set(requestId, {
            requesterId,
            approverIds,
            approvals: new Set(),
            rejections: new Set(),
            url: requestUrl,
            details: requestDetails,
            status: 'PENDING',
            teamId
        });

        const messageText = `Approval requested:\n*${requestDetails}*\n*URL:* ${requestUrl}`;
        const requesterInfo = `*Requested By:*\n<@${requesterId}>`;
        const approversInfo = `*Approvers:*\n${approverIds.map(id => `<@${id}>`).join(', ')}`;

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
slackApp.action("approve_action", async ({ ack, body, client, action }) => {
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
                                text: `*Approvers:*\n${request.approverIds.map(id => `<@${id}>`).join(', ')}`,
                            },
                            {
                                type: "mrkdwn",
                                text: `*Approved By:*\n${Array.from(request.approvals).map(id => `<@${id}>`).join(', ') || 'None'}`,
                            },
                        ],
                    },
                ],
            });

            if (request.approvals.size === request.approverIds.length) {
                request.status = 'APPROVED';
                
                // Notify requester
                await client.chat.postMessage({
                    channel: request.requesterId,
                    text: `Your request has been approved by all approvers!\n*URL:* ${request.url}`,
                });

                // Notify all approvers
                for (const id of request.approverIds) {
                    await client.chat.postMessage({
                        channel: id,
                        text: `The request from <@${request.requesterId}> has been fully approved.\n*URL:* ${request.url}`,
                    });
                }

                // Log completion
                await logToRecordkeeping(client,
                    `✅ *Approval Request Completed*\n` +
                    `• *Requester:* <@${request.requesterId}>\n` +
                    `• *Status:* Approved\n` +
                    `• *URL:* ${request.url}\n` +
                    `• *Approvers:* ${Array.from(request.approvals).map(id => `<@${id}>`).join(', ')}\n` +
                    `• *Request ID:* ${requestId}`,
                    request.teamId
                );
            } else {
                // Notify about partial approval
                const remainingApprovers = request.approverIds.filter(id => !request.approvals.has(id));
                await client.chat.postMessage({
                    channel: request.requesterId,
                    text: `Your request was approved by <@${approverId}>. Waiting for ${remainingApprovers.length} more approver(s):\n${remainingApprovers.map(id => `<@${id}>`).join(', ')}\n*URL:* ${request.url}`,
                });

                // Log partial approval
                await logToRecordkeeping(client,
                    `👍 *Partial Approval*\n` +
                    `• *Requester:* <@${request.requesterId}>\n` +
                    `• *Approved By:* <@${approverId}>\n` +
                    `• *Remaining Approvers:* ${remainingApprovers.map(id => `<@${id}>`).join(', ')}\n` +
                    `• *URL:* ${request.url}\n` +
                    `• *Request ID:* ${requestId}`,
                    request.teamId
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
slackApp.action("reject_action", async ({ ack, body, client, action }) => {
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
            await client.chat.update({
                channel: body.container.channel_id,
                ts: body.container.message_ts,
                text: `Approval request - REJECTED by <@${approverId}>`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `Approval request:\n*${request.details}*\n*URL:* ${request.url}\n\n*REJECTED* by <@${approverId}>`,
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
                            },
                            {
                                type: "mrkdwn",
                                text: `*Approvers:*\n${request.approverIds.map(id => `<@${id}>`).join(', ')}`,
                            },
                            {
                                type: "mrkdwn",
                                text: `*Rejected By:*\n<@${approverId}>`,
                            },
                        ],
                    },
                ],
            });
        } catch (updateError) {
            console.error('Error updating message:', updateError);
        }

        // Notify requester
        await client.chat.postMessage({
            channel: request.requesterId,
            text: `Your request was rejected by <@${approverId}>.\n*URL:* ${request.url}`,
        });

        // Notify other approvers
        for (const id of request.approverIds) {
            if (id !== approverId) {
                await client.chat.postMessage({
                    channel: id,
                    text: `The request from <@${request.requesterId}> was rejected by <@${approverId}>.\n*URL:* ${request.url}`,
                });
            }
        }

        // Log rejection
        await logToRecordkeeping(client,
            `❌ *Approval Request Rejected*\n` +
            `• *Requester:* <@${request.requesterId}>\n` +
            `• *Rejected By:* <@${approverId}>\n` +
            `• *URL:* ${request.url}\n` +
            `• *Request ID:* ${requestId}`,
            request.teamId
        );
    } catch (err) {
        console.error('Error handling reject action:', err);
    }
});

// Add specific handler for events
receiver.router.post('/slack/events', (req, res, next) => {
    console.log('Received Slack event:', JSON.stringify(req.body, null, 2));
    
    if (req.body.type === 'url_verification') {
        return res.json({ challenge: req.body.challenge });
    }
    
    next();
});

// OAuth callback handler
receiver.router.get('/oauth_redirect', async (req, res) => {
    try {
        const result = await receiver.installer.handleCallback(req, res);
        console.log('OAuth flow completed successfully:', result);
    } catch (error) {
        console.error('OAuth error:', error);
        res.send(`<p>OAuth error: ${error.message}</p>`);
    }
});

// Favicon handler
receiver.router.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Health check endpoint
receiver.router.get('/health', (req, res) => {
    res.send('OK');
});

// Error handling middleware
receiver.router.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the app
(async () => {
    try {
        await loadStoredChannels(); // Load stored channels
        const port = process.env.PORT || 3000;
        await slackApp.start(port);
        console.log(`⚡️ Slack app is running on port ${port}`);
        console.log(`🔗 Add to Slack URL: ${process.env.APP_URL}/slack/install`);
    } catch (error) {
        console.error('Unable to start app:', error);
        process.exit(1);
    }
})();