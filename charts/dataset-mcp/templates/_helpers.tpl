{{- define "dataset-mcp.name" -}}{{ .Chart.Name }}{{- end }}
{{- define "dataset-mcp.fullname" -}}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}{{- end }}
{{- define "dataset-mcp.labels" -}}
app.kubernetes.io/name: {{ include "dataset-mcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end }}
{{- define "dataset-mcp.serviceAccountName" -}}{{ if .Values.serviceAccount.create }}{{ default (include "dataset-mcp.fullname" .) .Values.serviceAccount.name }}{{ else }}{{ default "default" .Values.serviceAccount.name }}{{ end }}{{- end }}
