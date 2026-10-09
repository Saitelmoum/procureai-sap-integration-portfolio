import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonOutput

def Message processData(Message message) {

    def output = [
        orderId   : message.getProperty("orderId"),
        amountEUR : message.getProperty("amountEUR"),
        decision  : message.getProperty("decision"),
        reason    : message.getProperty("reason")
    ]

    message.setBody(JsonOutput.toJson(output))
    message.setHeader("Content-Type", "application/json")

    return message
}