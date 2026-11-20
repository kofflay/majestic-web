export async function getServerSideProps() {
  return { redirect: { destination: '/las-vegas/start', permanent: false } };
}
export default function LasVegasIndex() { return null; }
