# Project Timer

Track and visualize the time you spend on your projects with an enterprise-level dashboard.

## Features

- **Automatic Time Tracking:** Records time spent on each project with 10-minute inactivity timeout
- **Enterprise Dashboard:** Visualize your time data with beautiful charts and tables
- **Multiple Views:** Access your data through status bar, activity panel, or full dashboard
- **Export Functionality:** Export your time data in JSON or CSV formats

## How It Works

Project Timer automatically detects when you're working on a project and tracks your active time. When you're inactive for 10 minutes, it pauses tracking to ensure accurate time measurements.

### Dashboard

Open the dashboard by clicking on the timer in the status bar or by using the command "Project Timer: Show Dashboard". The dashboard provides:

- Current session time and controls
- Today's project breakdown (pie chart)
- Weekly activity summary (bar chart)
- Complete project history
- Recent daily activity

## Commands

- `Project Timer: Show Dashboard` - Open the enterprise dashboard
- `Project Timer: Start Tracking` - Manually start the timer
- `Project Timer: Stop Tracking` - Manually stop the timer
- `Project Timer: Reset Today's Stats` - Reset today's tracking data

## Extension Settings

* `projectTimer.inactivityThreshold`: Number of minutes of inactivity before the timer automatically pauses (default: 10)

## Development

### Building

```bash
npm install
npm run compile
```

### Packaging

```bash
npm run package
```

## License

This extension is licensed under the MIT License.
