import com.sap.gateway.ip.core.customdev.util.Message
import groovy.util.XmlSlurper

def Message processData(Message message) {

    def reader = message.getBody(java.io.Reader)
    def xml = new XmlSlurper().parse(reader)

    def validNode =
        xml.'**'.find { it.name() == 'valid' }

    if (!validNode) {
        throw new IllegalStateException(
            "VIES response does not contain a valid field"
        )
    }

    def valid =
        validNode.text().trim().equalsIgnoreCase("true")

    def nameNode =
        xml.'**'.find { it.name() == 'name' }

    def addressNode =
        xml.'**'.find { it.name() == 'address' }

    def requestDateNode =
        xml.'**'.find { it.name() == 'requestDate' }

    message.setProperty(
        "vatValid",
        valid
    )

    message.setProperty(
        "vatStatus",
        valid ? "VALID" : "INVALID"
    )

    message.setProperty(
        "viesName",
        nameNode?.text()?.trim()
    )

    message.setProperty(
        "viesAddress",
        addressNode?.text()?.trim()
    )

    message.setProperty(
        "viesRequestDate",
        requestDateNode?.text()?.trim()
    )

    return message
}