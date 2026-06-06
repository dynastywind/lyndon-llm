{{/*
Expand the chart name.
*/}}
{{- define "lyndon-llm.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a fully-qualified app name.
*/}}
{{- define "lyndon-llm.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label — used in selector.matchLabels.
*/}}
{{- define "lyndon-llm.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels attached to every resource.
*/}}
{{- define "lyndon-llm.labels" -}}
helm.sh/chart: {{ include "lyndon-llm.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels for a given component (backend | frontend | qdrant).
*/}}
{{- define "lyndon-llm.selectorLabels" -}}
app.kubernetes.io/name: {{ include "lyndon-llm.name" . }}-{{ .component }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Name of the backend Secret.
Returns existingSecret when set (Method B); otherwise the chart-managed name (Method A).
*/}}
{{- define "lyndon-llm.backendSecretName" -}}
{{- if .Values.backend.existingSecret }}
{{- .Values.backend.existingSecret }}
{{- else }}
{{- include "lyndon-llm.fullname" . }}-backend-secret
{{- end }}
{{- end }}
