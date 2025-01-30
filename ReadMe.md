# GetApproved - Slack Approval Bot

GetApproved is a Slack bot that streamlines the approval process within your workspace. It allows users to request approvals, manages the approval workflow, and keeps a log of all approval activities.

## Features

- Request approvals with URL and details
- Select multiple approvers
- Track approval status in real-time
- Automated notifications for all participants
- Dedicated logging channel for approval activities
- Easy to use `/getapproved` slash command
- Persistent storage of approvals and settings

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- A Slack workspace with admin privileges
- ngrok (for local development)

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/getapprovedbot.git
cd getapprovedbot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app and select your workspace

### 4. Configure Slack App Settings

#### Bot Token Scopes
Add the following OAuth scopes in **OAuth & Permissions**:
- `app_mentions:read`
- `channels:history`
- `channels:read`
- `channels:join`
- `channels:manage`
- `chat:write`
- `commands`
- `groups:history`
- `groups:read`
- `im:history`
- `im:read`
- `im:write`
- `mpim:history`
- `mpim:read`
- `mpim:write`
- `users:read`
- `team:read`

#### Slash Commands
Create a new slash command in **Slash Commands**:
- Command: `/getapproved`
- Request URL: `https://your-domain.com/slack/events`
- Description: "Request approval for your changes"
- Usage hint: "[URL] [description]"

#### Event Subscriptions
Enable Events in **Event Subscriptions** and set:
- Request URL: `https://your-domain.com/slack/events`

#### Interactivity
Enable Interactivity in **Interactivity & Shortcuts** and set:
- Request URL: `https://your-domain.com/slack/events`

### 5. Environment Setup

Create a `.env` file in the project root:

```env
SLACK_SIGNING_SECRET=your_signing_secret
SLACK_CLIENT_ID=your_client_id
SLACK_CLIENT_SECRET=your_client_secret
APP_URL=your_app_url
PORT=3000
```

Replace the values with your Slack app credentials from the **Basic Information** page.

### 6. Local Development

1. Start ngrok:
```bash
ngrok http 3000
```

2. Update your Slack app's request URLs with your ngrok URL

3. Start the application:
```bash
npm run dev
```

### 7. Production Deployment

1. Deploy to your hosting platform
2. Update environment variables
3. Update Slack app request URLs with your production domain

## Usage

1. Type `/getapproved` in any Slack channel
2. First time: Select a logging channel for approval activities
3. Fill in the approval request form:
   - Select approvers
   - Enter URL for review
   - Add request details
4. Submit the form

Approvers will receive a direct message with:
- Request details
- Approve/Reject buttons
- Current status

All approval activities will be logged in the selected logging channel.

## Local Development

```bash
# Install dependencies
npm install

# Run in development mode with nodemon
npm run dev

# Run in production mode
npm start
```



## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or need help, please:
1. Check the [Issues](https://github.com/gchorba/getapprovedbot/issues) page
2. Create a new issue if your problem isn't already listed
3. Provide as much detail as possible about your setup and the issue

## Acknowledgments

- Built with [Slack Bolt Framework](https://slack.dev/bolt-js/concepts)