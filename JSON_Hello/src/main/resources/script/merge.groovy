import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonSlurper
import groovy.json.JsonOutput

def Message processData(Message message) {

    // Ancien body sauvegardé avant le Request Reply
    def originalText = message.getProperty("originalPayload").toString()
    def original = new JsonSlurper().parseText(originalText)

    // Body actuel = réponse de l'API externe
    def reader = message.getBody(java.io.Reader)
    def external = new JsonSlurper().parse(reader)

    // Fusion des deux
    def output = [
        message: original.message,
        job: original.job,
        sourceSystem: original.sourceSystem,
        exerciseVersion: original.exerciseVersion,

        externalTodo: [
            id: external.id,
            title: external.title,
            completed: external.completed
        ]
    ]

    message.setBody(JsonOutput.toJson(output))
    message.setHeader("Content-Type", "application/json")

    return message
}