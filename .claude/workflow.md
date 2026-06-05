# Workflow de desarrollo y diagnóstico — GreenWave PowerNode Homey App

## 1. Arrancar la app en modo desarrollo

```bash
cd C:\Developer\com.greenwavesystems
homey app run --remote
```

El proceso corre en background. La CLI devuelve un **task ID** y una **ruta al fichero de log**, por ejemplo:
```
C:\Users\carlos\AppData\Local\Temp\claude\C--Developer-com-greenwavesystems-master\<uuid>\tasks\<taskId>.output
```

Guarda esa ruta — es donde se escriben todos los logs en tiempo real.

---

## 2. Leer logs

### Últimas líneas (general)
```
Read <ruta>.output  (offset al final, limit 50)
```

### Filtrar líneas relevantes
```
Grep pattern="measure_power|_onReport|Endpoint|error" path=<ruta>.output
```

### Filtrar por toma específica (usar el Device ID)
| Toma | Device ID |
|------|-----------|
| Root | 2daa069f-5250-4162-9392-94c84dab0d51 |
| S1   | 3533f729-dd58-4e7c-a2e9-35cfe5f15c5c |
| S2   | 1559cb9b-b843-4a7e-91cc-387e2daae310 |
| S3   | 340e3b55-751e-45bd-84c6-13c3e21b1101 |
| S4   | ad874050-6692-40aa-80da-41f51e9f4e85 |
| S5   | f9630e2f-cd45-4a28-a9f3-4b08129d056c |
| S6   | 34310c3a-2fa0-463d-add6-cdd834241d82 |

---

## 3. Leer consumos actuales de todas las tomas (via API)

```powershell
$sockets = [ordered]@{
  "S1" = "3533f729-dd58-4e7c-a2e9-35cfe5f15c5c"
  "S2" = "1559cb9b-b843-4a7e-91cc-387e2daae310"
  "S3" = "340e3b55-751e-45bd-84c6-13c3e21b1101"
  "S4" = "ad874050-6692-40aa-80da-41f51e9f4e85"
  "S5" = "f9630e2f-cd45-4a28-a9f3-4b08129d056c"
  "S6" = "34310c3a-2fa0-463d-add6-cdd834241d82"
}
homey api raw --path /api/manager/devices/device --json 2>&1 | Out-File "C:\Temp\hd.json" -Encoding utf8
$data = Get-Content "C:\Temp\hd.json" -Raw | ConvertFrom-Json
foreach ($s in $sockets.GetEnumerator()) {
  $d = $data.($s.Value)
  $onoff = if ($d.capabilitiesObj.onoff.value) { "ON " } else { "OFF" }
  $w   = $d.capabilitiesObj.measure_power.value
  $kwh = $d.capabilitiesObj.meter_power.value
  $tw  = [DateTimeOffset]::FromUnixTimeMilliseconds($d.capabilitiesObj.measure_power.lastUpdated).ToLocalTime().ToString("HH:mm:ss")
  Write-Output ("{0}: {1}  W={2,6}  ({3})   kWh={4}" -f $s.Key, $onoff, $w, $tw, $kwh)
}
```

---

## 4. Encender / apagar tomas via API

```powershell
homey api devices set-capability-value --device-id <deviceId> --capability-id onoff --value true
homey api devices set-capability-value --device-id <deviceId> --capability-id onoff --value false
```

---

## 5. Estructura del proyecto

```
drivers/
  powernode-1/
    device.js                  # Driver toma única
    driver.compose.json
    driver.settings.compose.json
  powernode-6/
    device.js                  # Driver 6 tomas — lógica principal
    driver.compose.json        # Z-Wave config: asociaciones, parámetros, multiChannelNodes
    driver.settings.compose.json  # Parámetros de configuración expuestos al usuario
```

---

## 6. Bug conocido del firmware (tratado en el código)

**`treatDestinationEndpointAsSource`**: El firmware del GreenWave PowerNode 6 envía todos los
reportes espontáneos de medida (METER_REPORT) como si vinieran del MultiChannelNode 1,
independientemente de qué toma generó el consumo.

**Solución implementada** (`device.js`):
- El **root device** registra un listener en MultiChannelNode 1 para METER_REPORT.
- Cuando llega un reporte espontáneo (cambio ≥10%), llama a `_getCapabilityValue('measure_power', 'METER')` en cada sub-device.
- Cada sub-device envía su propio `METER_GET` al endpoint correcto y recibe la respuesta correcta.
- Resultado: consumo correcto por toma con latencia de ~1-2 segundos.

---

## 7. Parámetros Z-Wave del dispositivo

| Param | Descripción | Default Homey |
|-------|-------------|---------------|
| 0 | Variación mínima de corriente para enviar reporte (%) | 10 |
| 1 | Keep-alive time (minutos sin contacto antes de parpadear) | 255 |

---

## 8. Intervalos de polling configurables (settings del dispositivo)

| Setting | Default | Descripción |
|---------|---------|-------------|
| poll_interval_measure | 0 (desactivado) | Polling W por toma (seg) |
| poll_interval_meter   | 300             | Polling kWh por toma (seg) |
| poll_interval_onoff   | 0 (desactivado) | Polling estado on/off (seg) |
