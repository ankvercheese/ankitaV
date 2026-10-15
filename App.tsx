import LetterCloth from "./Christmas"

export default function App() {
    return (
        <div style={{ width: "100vw", height: "100vh" }}>
            <LetterCloth
                text="merry christmas! "
                fontSize={12}
                letterColor="#4e1125"
                highlightColor="#fff9d0"
                backgroundColor="#161632"
                radius={60}
                stiffness={100}
                damping={0.5}
                gravity={10}
                brush={2}
                volume={0.1}
                noteInterval={170}
                reverbAmount={0.24}
                soundEnabled={true}
                snow={500}
                snowColor="#eee5e5"
                frontImage="/window.png"
            />
        </div>
    )
}