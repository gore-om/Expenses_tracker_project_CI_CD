pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    booleanParam(
      name: 'RUN_TERRAFORM',
      defaultValue: false,
      description: 'Run Terraform from Jenkins. Keep false when infrastructure was created manually from your local terminal.'
    )
    booleanParam(
      name: 'APPLY_TERRAFORM',
      defaultValue: false,
      description: 'Apply Terraform from Jenkins. Requires RUN_TERRAFORM=true.'
    )
    string(name: 'AZURE_LOCATION', defaultValue: 'centralindia', description: 'Azure region for Terraform resources.')
    string(name: 'RESOURCE_GROUP_NAME', defaultValue: 'rg-az104-dev-eus', description: 'Azure resource group name.')
    string(name: 'ACR_NAME', defaultValue: 'ogccr', description: 'Globally unique ACR name without .azurecr.io.')
    string(name: 'AKS_NAME', defaultValue: 'myogcck8scluster', description: 'AKS cluster name.')
    string(name: 'POSTGRES_SERVER_NAME', defaultValue: 'sovereign-db-7319', description: 'Globally unique PostgreSQL Flexible Server name.')
    string(name: 'POSTGRES_HOST', defaultValue: 'sovereign-db-7319.postgres.database.azure.com', description: 'PostgreSQL host from Terraform output. Required when RUN_TERRAFORM=false.')
    string(name: 'POSTGRES_DATABASE', defaultValue: 'expensesdb', description: 'PostgreSQL database name.')
    string(name: 'POSTGRES_USER', defaultValue: 'pgadmin', description: 'PostgreSQL administrator username.')
  }

  environment {
    APP_NAME = 'ledgerly'
    K8S_NAMESPACE = 'ledgerly'
    TF_DIR = 'terraform_code_infra/Code_1'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.GIT_SHORT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.RELEASE_VERSION = sh(script: 'cat VERSION', returnStdout: true).trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_SHORT_SHA}"
        }
      }
    }

    stage('Validate App') {
      steps {
        sh 'docker run --rm -v "$PWD/app/backend:/app" -w /app node:22-alpine node --check src/server.js'
      }
    }

    stage('Azure Login') {
      steps {
        withCredentials([
          string(credentialsId: 'azure-client-id', variable: 'AZURE_CLIENT_ID'),
          string(credentialsId: 'azure-client-secret', variable: 'AZURE_CLIENT_SECRET'),
          string(credentialsId: 'azure-tenant-id', variable: 'AZURE_TENANT_ID'),
          string(credentialsId: 'azure-subscription-id', variable: 'AZURE_SUBSCRIPTION_ID')
        ]) {
          sh '''
            az login --service-principal \
              -u "$AZURE_CLIENT_ID" \
              -p "$AZURE_CLIENT_SECRET" \
              --tenant "$AZURE_TENANT_ID"

            az account set --subscription "$AZURE_SUBSCRIPTION_ID"
          '''
        }
      }
    }

    stage('Terraform Init') {
      when {
        expression { return params.RUN_TERRAFORM }
      }
      steps {
        dir("${env.TF_DIR}") {
          sh 'terraform init -input=false'
          sh 'terraform validate'
        }
      }
    }

    stage('Terraform Plan') {
      when {
        expression { return params.RUN_TERRAFORM }
      }
      steps {
        dir("${env.TF_DIR}") {
          withCredentials([string(credentialsId: 'postgres-admin-password', variable: 'TF_VAR_db_password')]) {
            withEnv([
              "TF_VAR_location=${params.AZURE_LOCATION}",
              "TF_VAR_resource_group_name=${params.RESOURCE_GROUP_NAME}",
              "TF_VAR_acr_name=${params.ACR_NAME}",
              "TF_VAR_aks_name=${params.AKS_NAME}",
              "TF_VAR_postgres_server_name=${params.POSTGRES_SERVER_NAME}"
            ]) {
              sh 'terraform plan -input=false -out=tfplan'
            }
          }
        }
      }
    }

    stage('Terraform Apply') {
      when {
        expression { return params.RUN_TERRAFORM && params.APPLY_TERRAFORM }
      }
      steps {
        dir("${env.TF_DIR}") {
          withCredentials([string(credentialsId: 'postgres-admin-password', variable: 'TF_VAR_db_password')]) {
            withEnv([
              "TF_VAR_location=${params.AZURE_LOCATION}",
              "TF_VAR_resource_group_name=${params.RESOURCE_GROUP_NAME}",
              "TF_VAR_acr_name=${params.ACR_NAME}",
              "TF_VAR_aks_name=${params.AKS_NAME}",
              "TF_VAR_postgres_server_name=${params.POSTGRES_SERVER_NAME}"
            ]) {
              sh 'terraform apply -input=false -auto-approve tfplan'
            }
          }
        }
      }
    }

    stage('Load Deployment Config') {
      steps {
        script {
          if (params.RUN_TERRAFORM) {
            dir("${env.TF_DIR}") {
              env.ACR_LOGIN_SERVER = sh(script: 'terraform output -raw acr_login_server', returnStdout: true).trim()
              env.ACR_NAME = env.ACR_LOGIN_SERVER.replace('.azurecr.io', '')
              env.AKS_RESOURCE_GROUP = sh(script: 'terraform output -raw resource_group_name', returnStdout: true).trim()
              env.AKS_CLUSTER_NAME = sh(script: 'terraform output -raw aks_cluster_name', returnStdout: true).trim()
              env.POSTGRES_HOST = sh(script: 'terraform output -raw postgres_host', returnStdout: true).trim()
              env.POSTGRES_DATABASE = sh(script: 'terraform output -raw postgres_database', returnStdout: true).trim()
              env.POSTGRES_USER = sh(script: 'terraform output -raw postgres_user', returnStdout: true).trim()
            }
          } else {
            if (!params.POSTGRES_HOST?.trim()) {
              error('POSTGRES_HOST is required when RUN_TERRAFORM=false.')
            }

            env.ACR_NAME = params.ACR_NAME.trim()
            env.ACR_LOGIN_SERVER = "${env.ACR_NAME}.azurecr.io"
            env.AKS_RESOURCE_GROUP = params.RESOURCE_GROUP_NAME.trim()
            env.AKS_CLUSTER_NAME = params.AKS_NAME.trim()
            env.POSTGRES_HOST = params.POSTGRES_HOST.trim()
            env.POSTGRES_DATABASE = params.POSTGRES_DATABASE.trim()
            env.POSTGRES_USER = params.POSTGRES_USER.trim()
          }
        }
      }
    }
    stage('Build Images') {
      steps {
        sh '''
          docker build -t "$ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG" ./app/frontend
          docker build -t "$ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG" ./app/backend
        '''
      }
    }

    stage('Push Images') {
      steps {
        sh '''
          az acr login --name "$ACR_NAME"
          docker push "$ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG"
          docker push "$ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG"
        '''
      }
    }

    stage('Deploy To AKS') {
      steps {
        withCredentials([string(credentialsId: 'postgres-admin-password', variable: 'POSTGRES_PASSWORD')]) {
          sh '''
            az aks get-credentials \
              --resource-group "$AKS_RESOURCE_GROUP" \
              --name "$AKS_CLUSTER_NAME" \
              --overwrite-existing

            kubectl create namespace "$K8S_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

            set +x
            DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:5432/$POSTGRES_DATABASE"
            kubectl -n "$K8S_NAMESPACE" create secret generic ledgerly-secrets \
              --from-literal=DATABASE_URL="$DATABASE_URL" \
              --from-literal=DB_SSL='true' \
              --dry-run=client -o yaml | kubectl apply -f -
            set -x

            mkdir -p .rendered-k8s
            cp k8s/00-namespace.yaml .rendered-k8s/00-namespace.yaml
            cp k8s/02-backend.yaml .rendered-k8s/02-backend.yaml
            cp k8s/03-frontend.yaml .rendered-k8s/03-frontend.yaml
            cp k8s/04-ingress.yaml .rendered-k8s/04-ingress.yaml

            sed -i "s#ledgerly-placeholder.azurecr.io/ledgerly-frontend:latest#$ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG#g" .rendered-k8s/03-frontend.yaml
            sed -i "s#ledgerly-placeholder.azurecr.io/ledgerly-backend:latest#$ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG#g" .rendered-k8s/02-backend.yaml

            kubectl apply -f .rendered-k8s/00-namespace.yaml
            kubectl apply -f .rendered-k8s/02-backend.yaml
            kubectl apply -f .rendered-k8s/03-frontend.yaml
            kubectl apply -f .rendered-k8s/04-ingress.yaml

            kubectl -n "$K8S_NAMESPACE" set image deployment/ledgerly-frontend \
              frontend="$ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG"

            kubectl -n "$K8S_NAMESPACE" set image deployment/ledgerly-backend \
              backend="$ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG"

            kubectl -n "$K8S_NAMESPACE" set env deployment/ledgerly-backend \
              APP_VERSION="$RELEASE_VERSION"

            kubectl -n "$K8S_NAMESPACE" rollout status deployment/ledgerly-frontend --timeout=180s
            kubectl -n "$K8S_NAMESPACE" rollout status deployment/ledgerly-backend --timeout=180s
          '''
        }
      }
    }
  }

  post {
    always {
      sh 'docker image prune -f || true'
    }
  }
}
