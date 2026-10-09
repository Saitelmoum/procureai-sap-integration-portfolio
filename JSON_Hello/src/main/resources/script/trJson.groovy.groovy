import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonSlurper
import groovy.json.JsonOutput

def Message processData(Message message) {

    def reader = message.getBody(java.io.Reader)
    def input = new JsonSlurper().parse(reader)
    message.setProperty("job", input.job)
    def jobCode = input.job.replace(" ", "_").toUpperCase()
    message.setProperty("jobCode", jobCode)

    def sourceSystem = message.getProperty("sourceSystem")
    def exerciseVersion = message.getHeader("X-Exercise-Version", String)

    def output = [
        message: "Hello ${input.name}",
        job: input.job,
        sourceSystem: sourceSystem,
        exerciseVersion: exerciseVersion,
        processedBy: "SAP Integration Suite"
    ]

    message.setBody(JsonOutput.toJson(output))
    message.setHeader("Content-Type", "application/json")

    return message
}