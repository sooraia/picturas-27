import pika
from pika.exchange_type import ExchangeType

"""
# Callback example for those who need it
def callback(ch, method, properties, body):
    print(f" [x] Received {body.decode()}")
"""

class Rabbit_MQ:
    # heartbeat=None mantém o valor negociado com o broker; 0 desativa-o (pedidos
    # longos, como vídeo, bloqueiam a ligação e o broker fechá-la-ia por falta de heartbeat)
    def __init__(self, host, port, username, password, heartbeat=None):
        self._host = host
        self._port = port
        self._credentials = pika.PlainCredentials(username, password)
        self._connection = pika.BlockingConnection(pika.ConnectionParameters(self._host, self._port, '/', self._credentials, heartbeat=heartbeat),)
        self._channel = self._connection.channel()
        self._queue = ''
        
        self._channel.exchange_declare(
            exchange="picturas",
            exchange_type=ExchangeType.direct,
            durable=True,
        )

    def send_rabbit_msg(self, msg, queue):
        self._channel.queue_declare(queue=self._queue, durable=True)

        self._channel.basic_publish(exchange="picturas", routing_key=queue, body=msg)

    
    def read_rabbit_msg(self, queue, callback):
        if self._queue == "":
            self._queue = queue

        self._channel.queue_declare(queue=self._queue, durable=True)
        
        self._channel.basic_consume(
            queue=self._queue,
            on_message_callback=callback,
            auto_ack=True,
        )

        self._channel.start_consuming()
