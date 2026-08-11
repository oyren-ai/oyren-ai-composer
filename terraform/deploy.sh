#!/usr/bin/env bash
# One-click Oyren self-hosted infrastructure deployment
# Usage: ./deploy.sh [environment]
#
# This script helps you deploy your own private Oyren infrastructure
# so you can run agents without sharing code with Oyren's hosted service.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="${SCRIPT_DIR}/environments/${ENVIRONMENT}"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Oyren Self-Hosted Infrastructure Deployment             ║${NC}"
echo -e "${BLUE}║  Deploy your own private Oyren agents infrastructure      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if environment exists
if [ ! -d "$ENV_DIR" ]; then
    echo -e "${RED}Error: Environment '${ENVIRONMENT}' not found${NC}"
    echo "Available environments:"
    ls -1 "${SCRIPT_DIR}/environments" 2>/dev/null || echo "  (none found)"
    exit 1
fi

# Check for Terraform
if ! command -v terraform &> /dev/null; then
    echo -e "${RED}Error: Terraform is not installed${NC}"
    echo ""
    echo "Please install Terraform first:"
    echo "  macOS:   brew install terraform"
    echo "  Linux:   https://www.terraform.io/downloads"
    echo "  Windows: choco install terraform"
    exit 1
fi

echo -e "${GREEN}✓${NC} Terraform found: $(terraform version -json | grep -o '"terraform_version":"[^"]*' | cut -d'"' -f4)"

cd "$ENV_DIR"

# Check for configuration file
if [ ! -f "${ENVIRONMENT}.tfvars" ]; then
    echo ""
    echo -e "${YELLOW}⚠${NC}  Configuration file not found: ${ENVIRONMENT}.tfvars"

    if [ -f "${ENVIRONMENT}.tfvars.example" ]; then
        echo -e "${BLUE}Creating configuration from example...${NC}"
        cp "${ENVIRONMENT}.tfvars.example" "${ENVIRONMENT}.tfvars"

        echo ""
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${YELLOW}  ACTION REQUIRED: Edit your configuration${NC}"
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo "Please edit ${ENVIRONMENT}.tfvars and add your:"
        echo "  1. DigitalOcean API token (get from: https://cloud.digitalocean.com/account/api/tokens)"
        echo "  2. SSH key IDs (run: doctl compute ssh-key list)"
        echo ""
        echo "Then run this script again."
        echo ""

        # Open the file in the default editor if possible
        if [ -n "${EDITOR:-}" ]; then
            echo -e "${BLUE}Opening in $EDITOR...${NC}"
            $EDITOR "${ENVIRONMENT}.tfvars"
        else
            echo "Example command:"
            echo -e "  ${BLUE}vim ${ENV_DIR}/${ENVIRONMENT}.tfvars${NC}"
        fi

        exit 0
    else
        echo -e "${RED}Error: No example configuration found${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓${NC} Configuration file found"

# Validate the configuration has required values
if grep -q "dop_v1_xxxxxxxx" "${ENVIRONMENT}.tfvars" 2>/dev/null; then
    echo ""
    echo -e "${RED}Error: Configuration not completed${NC}"
    echo "Please edit ${ENVIRONMENT}.tfvars and replace placeholder values with your actual:"
    echo "  - DigitalOcean API token"
    echo "  - SSH key IDs"
    exit 1
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Deployment Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Environment:     ${ENVIRONMENT}"
echo "Configuration:   ${ENVIRONMENT}.tfvars"
echo "Location:        $ENV_DIR"
echo ""

# Show cost estimate for the environment
case $ENVIRONMENT in
    dev)
        echo -e "Estimated cost:  ${GREEN}~\$8/month${NC}"
        echo "Resources:       1 droplet (1GB RAM), VPC, firewall"
        ;;
    staging)
        echo -e "Estimated cost:  ${YELLOW}~\$40/month${NC}"
        echo "Resources:       2 droplets (2GB RAM each), load balancer, VPC"
        ;;
    prod)
        echo -e "Estimated cost:  ${YELLOW}~\$110/month${NC}"
        echo "Resources:       3+ droplets (4GB RAM each), load balancer, monitoring"
        ;;
esac

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Initialize Terraform if needed
if [ ! -d ".terraform" ]; then
    echo -e "${BLUE}Initializing Terraform...${NC}"
    terraform init
    echo ""
fi

# Run terraform plan
echo -e "${BLUE}Generating deployment plan...${NC}"
echo ""

if ! terraform plan -var-file="${ENVIRONMENT}.tfvars" -out=tfplan; then
    echo ""
    echo -e "${RED}Error: Terraform plan failed${NC}"
    echo "Please check your configuration and try again."
    exit 1
fi

echo ""
echo -e "${GREEN}✓${NC} Plan generated successfully"
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Ready to Deploy${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This will create your private Oyren infrastructure."
echo "Your code and data will NEVER leave your servers."
echo ""
echo -e "${BLUE}What happens next:${NC}"
echo "  1. DigitalOcean resources will be created"
echo "  2. Servers will be provisioned with Docker"
echo "  3. Security hardening will be applied"
echo "  4. You'll receive connection details"
echo ""

# Confirm deployment
read -p "$(echo -e ${GREEN}Proceed with deployment? [y/N]:${NC} )" -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Deployment cancelled${NC}"
    echo "To deploy later, run: terraform apply -var-file=\"${ENVIRONMENT}.tfvars\""
    exit 0
fi

# Apply the plan
echo ""
echo -e "${BLUE}Deploying infrastructure...${NC}"
echo ""

if terraform apply tfplan; then
    rm -f tfplan

    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  🎉 Deployment Successful!                                 ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Show outputs
    echo -e "${BLUE}Your Infrastructure Details:${NC}"
    echo ""
    terraform output

    echo ""
    echo -e "${GREEN}Next Steps:${NC}"
    echo "  1. SSH into your server:"
    echo -e "     ${BLUE}$(terraform output -raw connection_string 2>/dev/null || echo "ssh root@<your-ip>")${NC}"
    echo ""
    echo "  2. Clone and set up Oyren Composer:"
    echo -e "     ${BLUE}cd /srv/script-runner"
    echo -e "     git clone https://github.com/oyren-ai/oyren-ai-composer.git app"
    echo -e "     cd app && cp .env.example .env${NC}"
    echo ""
    echo "  3. Configure your environment:"
    echo -e "     ${BLUE}vim .env  # Add your SCRIPT_RUNNER_TOKEN${NC}"
    echo ""
    echo "  4. Start the services:"
    echo -e "     ${BLUE}docker compose up -d${NC}"
    echo ""
    echo -e "${GREEN}🔒 Your code and data remain 100% private on your infrastructure${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}Deployment failed${NC}"
    echo "Check the error messages above for details."
    exit 1
fi
