pipeline {
  agent any

  environment {
    APP_NAME = 'ledgerly'
    ACR_NAME = 'ogccr'
    ACR_LOGIN_SERVER = 'ogccr.azurecr.io'

    AKS_RESOURCE_GROUP = 'rg-az104-dev-eus'
    AKS_CLUSTER_NAME = 'myogcck8scluster'
    K8S_NAMESPACE = 'ledgerly'
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

    stage('Build Images') {
      steps {
        sh """
          docker build -t $ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG ./app/frontend
          docker build -t $ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG ./app/backend
        """
      }
    }

    stage('Azure Login') {
      steps {
        withCredentials([
          string(credentialsId: 'azure-client-id', variable: 'AZURE_CLIENT_ID'),
          string(credentialsId: 'azure-client-secret', variable: 'AZURE_CLIENT_SECRET'),
          string(credentialsId: 'azure-tenant-id', variable: 'AZURE_TENANT_ID')
        ]) {
          sh """
            az login --service-principal \
              -u $AZURE_CLIENT_ID \
              -p $AZURE_CLIENT_SECRET \
              --tenant $AZURE_TENANT_ID

            az acr login --name $ACR_NAME
          """
        }
      }
    }

    stage('Push Images') {
      steps {
        sh """
          docker push $ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG
          docker push $ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG
        """
      }
    }

    stage('Deploy To AKS') {
      steps {

        sh """
          az aks get-credentials \
            --resource-group $AKS_RESOURCE_GROUP \
            --name $AKS_CLUSTER_NAME \
            --overwrite-existing
        """

        sh """
          kubectl create namespace $K8S_NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
        """

        # Apply ONLY infra (NO deployments here)
        sh """
          kubectl -n $K8S_NAMESPACE apply -f k8s/
        """

        # Update frontend image
        sh """
          kubectl -n $K8S_NAMESPACE set image deployment/ledgerly-frontend \
          frontend=$ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG
        """

        # Update backend image
        sh """
          kubectl -n $K8S_NAMESPACE set image deployment/ledgerly-backend \
          backend=$ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG
        """

        # Wait for rollout (fail pipeline if broken)
        sh """
          kubectl -n $K8S_NAMESPACE rollout status deployment/ledgerly-frontend --timeout=180s
          kubectl -n $K8S_NAMESPACE rollout status deployment/ledgerly-backend --timeout=180s
        """
      }
    }
  }

  post {
    always {
      sh 'docker image prune -f || true'
    }
  }
}