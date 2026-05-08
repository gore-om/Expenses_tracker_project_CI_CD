pipeline {
  agent any

  environment {
    APP_NAME = 'ledgerly'
    ACR_NAME = credentials('AZURE_ACR_NAME')
    ACR_LOGIN_SERVER = "${ACR_NAME}.azurecr.io"

    AKS_RESOURCE_GROUP = credentials('AZURE_AKS_RESOURCE_GROUP')
    AKS_CLUSTER_NAME = credentials('AZURE_AKS_CLUSTER_NAME')

    K8S_NAMESPACE = 'ledgerly'
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm

        script {
          env.GIT_SHORT_SHA = sh(
            returnStdout: true,
            script: 'git rev-parse --short HEAD'
          ).trim()

          env.RELEASE_VERSION = sh(
            returnStdout: true,
            script: 'cat VERSION'
          ).trim()

          env.APP_VERSION = env.RELEASE_VERSION
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
          azureServicePrincipal(
            credentialsId: 'AZURE_SERVICE_PRINCIPAL',
            subscriptionIdVariable: 'AZURE_SUBSCRIPTION_ID',
            clientIdVariable: 'AZURE_CLIENT_ID',
            clientSecretVariable: 'AZURE_CLIENT_SECRET',
            tenantIdVariable: 'AZURE_TENANT_ID'
          )
        ]) {

          sh '''
            az login --service-principal \
              -u $AZURE_CLIENT_ID \
              -p $AZURE_CLIENT_SECRET \
              --tenant $AZURE_TENANT_ID

            az account set --subscription $AZURE_SUBSCRIPTION_ID

            az acr login --name $ACR_NAME
          '''
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
          kubectl create namespace $K8S_NAMESPACE \
            --dry-run=client -o yaml | kubectl apply -f -
        """

        sh 'kubectl -n $K8S_NAMESPACE apply -f k8s/'

        sh """
          kubectl -n $K8S_NAMESPACE set image deployment/ledgerly-frontend \
          frontend=$ACR_LOGIN_SERVER/$APP_NAME-frontend:$IMAGE_TAG
        """

        sh """
          kubectl -n $K8S_NAMESPACE set image deployment/ledgerly-backend \
          backend=$ACR_LOGIN_SERVER/$APP_NAME-backend:$IMAGE_TAG
        """

        sh """
          kubectl -n $K8S_NAMESPACE rollout status deployment/ledgerly-frontend --timeout=180s
        """

        sh """
          kubectl -n $K8S_NAMESPACE rollout status deployment/ledgerly-backend --timeout=180s
        """
      }
    }
  }

  post {
    always {
      script {
        sh 'docker image prune -f || true'
      }
    }
  }
}