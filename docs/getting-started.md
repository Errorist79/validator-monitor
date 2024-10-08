# Getting Started Guide for Linux Users

This guide will help you set up and run the Aleo Network Monitor project on a Linux system.

## Prerequisites

Ensure that you have the following installed on your system:

- **Node.js** (version 14.x or higher)
- **npm** (Node Package Manager)
- **PostgreSQL** (version 12 or higher)
- **Git**

### Installing Node.js and npm

Install Node.js and npm using the package manager:

```
sudo apt-get update
sudo apt-get install -y nodejs npm
```

Alternatively, you can install the latest version from the [official Node.js website](https://nodejs.org/).

### Installing PostgreSQL

Install PostgreSQL and its contrib package:

```
sudo apt-get install -y postgresql postgresql-contrib
```

Ensure PostgreSQL service is running:

```
sudo service postgresql start
```

## Clone the Repository

Clone the project repository from GitHub:

```
git clone https://github.com/yourusername/aleo-network-monitor.git
cd aleo-network-monitor
```

## Setup Environment Variables

Copy the example environment file and configure it:

```
cp .env.example .env
```

Edit the `.env` file with your preferred editor:

```
nano .env
```

Set the necessary environment variables:

```
# .env file
DATABASE_URL=postgresql://username:password@localhost:5432/aleo_monitor
PORT=3000
JWT_SECRET=your_secret_key
```

## Install Dependencies

Install the project dependencies using npm:

```
npm install
```

## Database Setup

Create the PostgreSQL database and user:

```
sudo -u postgres psql
```

In the PostgreSQL shell, run the following commands:

```
CREATE DATABASE aleo_monitor;
CREATE USER yourusername WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE aleo_monitor TO yourusername;
```

Exit the PostgreSQL shell:

```
\q
```

Run database migrations to set up the schema:

```
npm run migrate
```

## Running the Application

Start the application in development mode:

```
npm run dev
```

The application should now be running at `http://localhost:3000`.

## Testing

To run the test suite:

```
npm test
```

## Building for Production

Build the application:

```
npm run build
```

Start the production server:

```
npm start
```

## Troubleshooting

- **Permission Denied Errors**: Ensure you have the necessary permissions and that services are running.
- **Port Conflicts**: Make sure that the ports used by the application are not occupied by other services.
- **Database Connection Issues**: Verify your PostgreSQL credentials and that the database service is running.

## Additional Resources

For more detailed information, refer to the following documents:

- [Project Overview](project-overview.md)
- [Configuration](configuration.md)
- [API Documentation](api.md)
- [Deployment Guide](deployment.md)