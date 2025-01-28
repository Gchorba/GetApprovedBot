const { App } = require("@slack/bolt");
require("dotenv").config();

const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// Configuration
const CONFIG = {
  DOCS_CHANNEL: process.env.DOCS_CHANNEL || 'docs' // Can be overridden by env variable
};

// Function to log approval activities to the docs channel
async function logToRecordkeeping(client, message) {
  try {
    // Try to find the channel first
    try {
      const result = await client.conversations.list({
        types: 'public_channel,private_channel'
      });
      
      const docsChannel = result.channels.find(
        channel => channel.name === CONFIG.DOCS_CHANNEL.replace('#', '')
      );

      if (!docsChannel) {
        console.warn(`Warning: Channel #${CONFIG.DOCS_CHANNEL} not found. Make sure the bot is invited to the channel.`);
        return;
      }

      await client.chat.postMessage({
        channel: docsChannel.id,
        text: message,
        unfurl_links: false
      });
    } catch (channelError) {
      console.warn(`Warning: Unable to post to #${CONFIG.DOCS_CHANNEL}:`, channelError.message);
    }
  } catch (err) {
    console.error('Error logging to docs channel:', err);
  }
}

// Store pending approvals in memory (consider using a database in production)
const pendingApprovals = new Map();

slackApp.command("/getapproved", async ({ ack, body, client }) => {
  try {
    await ack();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
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
        ],
      },
    });
  } catch (err) {
    console.error(err);
  }
});

slackApp.view("request-approval-modal", async ({ ack, body, client, view }) => {
  try {
    const approverIds = view.state.values.approvers_selection.selected_approvers.selected_users;
    const requestUrl = view.state.values.url_block.url_input.value;
    const requestDetails = view.state.values.details_block.details_input.value;
    const requesterId = body.user.id;

    // Generate a unique request ID
    const requestId = `req_${Date.now()}_${requesterId}`;

    // Log new approval request
    await logToRecordkeeping(client, 
      `🆕 *New Approval Request*\n` +
      `• *Requester:* <@${requesterId}>\n` +
      `• *Approvers:* ${approverIds.map(id => `<@${id}>`).join(', ')}\n` +
      `• *URL:* ${requestUrl}\n` +
      `• *Details:* ${requestDetails}\n` +
      `• *Request ID:* ${requestId}`
    );

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

    const messageText = `Approval requested:\n*${requestDetails}*\n*URL:* ${requestUrl}`;
    const requesterInfo = `*Requested By:*\n<@${requesterId}>`;
    const approversInfo = `*Approvers:*\n${approverIds.map(id => `<@${id}>`).join(', ')}`;

    // Send message to all approvers
    for (const approverId of approverIds) {
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
    }

    await client.chat.postMessage({
      channel: requesterId,
      text: `Your request has been sent to ${approverIds.length} approver${approverIds.length > 1 ? 's' : ''}\n*Description*: ${requestDetails}\n*URL*: ${requestUrl}`,
    });

    await ack();
  } catch (err) {
    console.error(err);
  }
});

slackApp.action("approve_action", async ({ ack, body, client, action }) => {
  try {
    // Immediately acknowledge the action
    await ack();
    
    console.log('Approval action received:', { action, body });
    
    // Extract the request ID (everything after 'approve_')
    const requestId = action.value.replace('approve_', '');
    const approverId = body.user.id;
    
    const request = pendingApprovals.get(requestId);
    console.log('Found request:', { requestId, request });
    
    if (!request || request.status !== 'PENDING') {
      await client.chat.postMessage({
        channel: approverId,
        text: "This request is no longer active or has already been processed."
      });
      return;
    }

    // Add the approval
    request.approvals.add(approverId);
    
    // Update the original message
    try {
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
    } catch (updateError) {
      console.error('Error updating message:', updateError);
    }

    // Check if all approvers have approved
    if (request.approvals.size === request.approverIds.length) {
      request.status = 'APPROVED';
      
      // Notify requester of full approval
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

      // Log full approval
      await logToRecordkeeping(client,
        `✅ *Approval Request Completed*\n` +
        `• *Requester:* <@${request.requesterId}>\n` +
        `• *Status:* Approved\n` +
        `• *URL:* ${request.url}\n` +
        `• *Approvers:* ${Array.from(request.approvals).map(id => `<@${id}>`).join(', ')}\n` +
        `• *Request ID:* ${requestId}`
      );
    } else {
      // Notify of partial approval
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
        `• *Request ID:* ${requestId}`
      );
    }

    await ack();
  } catch (err) {
    console.error(err);
  }
});

slackApp.action("reject_action", async ({ ack, body, client, action }) => {
  try {
    // Immediately acknowledge the action
    await ack();
    
    console.log('Reject action received:', { action, body });
    
    // Extract the request ID (everything after 'reject_')
    const requestId = action.value.replace('reject_', '');
    const approverId = body.user.id;
    
    const request = pendingApprovals.get(requestId);
    console.log('Found request:', { requestId, request });
    
    if (!request || request.status !== 'PENDING') {
      await client.chat.postMessage({
        channel: approverId,
        text: "This request is no longer active or has already been processed."
      });
      return;
    }

    request.status = 'REJECTED';
    request.rejections.add(approverId);
    
    // Update the original message
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

    // Notify requester of rejection
    await client.chat.postMessage({
      channel: request.requesterId,
      text: `Your request was rejected by <@${approverId}>.\n*URL:* ${request.url}`,
    });

    // Notify all approvers
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
      `• *Request ID:* ${requestId}`
    );

    await ack();
  } catch (err) {
    console.error(err);
  }
});

(async () => {
  await slackApp.start(process.env.PORT || 8000);
  console.log(`Slack bot is active on port ${process.env.PORT || 8000}`);
})();