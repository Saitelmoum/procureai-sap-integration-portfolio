import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonSlurper

def Message processData(Message message) {

    def reader = message.getBody(java.io.Reader)
    def response = new JsonSlurper().parse(reader)

    if (!response.rates?.EUR) {
        throw new IllegalStateException(
            "FX response does not contain EUR rate"
        )
    }

    def fxRate =
        new BigDecimal(response.rates.EUR.toString())

    def originalAmount =
        new BigDecimal(
            message.getProperty("originalAmount").toString()
        )

    def amountEUR =
        originalAmount.multiply(fxRate)

    amountEUR =
        amountEUR.setScale(
            2,
            java.math.RoundingMode.HALF_UP
        )

    message.setProperty("fxRate", fxRate)
    message.setProperty("amountEUR", amountEUR)
    message.setProperty(
        "fxRateDate",
        response.date?.toString()
    )

    return message
}